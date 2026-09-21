import { Deferred } from './deferred.ts';
import { resolveRangeHeader } from './http-range.ts';
import {
  awaitRealmIndexSettled,
  INDEX_WRITING_JOB_TYPES,
  readLaneHoldersBestEffort,
  indexingConcurrencyGroup,
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  CONTENT_MOVING_INDEX_JOB_TYPES,
  prerenderSpawnedPriority,
  unbuiltIndexFailure,
} from './jobs/indexing.ts';
import {
  awaitPublishedHtmlReady,
  enqueuePrerenderHtmlJob,
  prerenderHtmlConcurrencyGroup,
} from './jobs/prerender-html.ts';
import { JobClaimHold } from './jobs/claim-hold.ts';
import { settledBy } from './settled-by.ts';
import type { RealmVisibility } from './realm-visibility.ts';
import type { SearchOpts } from './search-utils.ts';
import { buildSearchErrorBody, SearchRequestError } from './search-utils.ts';
import {
  applyServerSearchPageBound,
  assembledLinkResourceBudget,
  isItemLegSearch,
  runWithSearchTimeBudget,
  SearchBoundError,
} from './search-bounds.ts';
import {
  LinkShapePolicy,
  requestedLinkShape,
  rowClassForPageSize,
  X_BOXEL_LINK_SHAPE_HEADER,
  type LinkShapeDecision,
  type LinkShapeRowClass,
} from './link-shape-policy.ts';

// The routes whose representation the link-shape preference selects declare it
// alongside `Accept`, so a shared cache keys on it rather than treating the
// two shapes as one resource and answering either caller with whichever it
// stored.
//
// What decides membership is whether an HTTP cache can key the response, not
// whether the response carries a shape. Source, modules and media carry no
// shape and leave the header off, since listing a header a route ignores only
// fragments its cache. The search routes do carry a shape and leave it off as
// well: they answer the QUERY verb with the query in the body — `_search`
// refuses every other method outright — so no HTTP cache reaches either body,
// and the in-process caches that do hold one key on the served mode directly.
const LINK_SHAPE_VARY = [X_BOXEL_LINK_SHAPE_HEADER];
import {
  CARD_DOCUMENT_CACHE_HEADER,
  type CardDocumentCache,
  type CardDocumentCacheOutcome,
  type CardJsonAssembly,
} from './card-document-cache.ts';
import {
  fieldsetFromParam,
  htmlQueryFromParams,
  parseSearchEntryQueryFromPayload,
  type SearchEntryFieldset,
  type SearchEntryQuery,
} from './search-entry.ts';
import {
  rri,
  type RealmResourceIdentifier,
  type RealmIdentifier,
} from './realm-identifiers.ts';
import {
  collectDependentModuleCacheInvalidations,
  extractModuleDependencyKeys,
  moduleDependencyKey,
} from './cache/module-cache-invalidation.ts';
import {
  makeCardTypeSummaryDoc,
  type SingleCardDocument,
  type SingleFileMetaDocument,
  type EntryCollectionDocument,
  type EntrySingleDocument,
} from './document-types.ts';
import type { HtmlQuery, HtmlResource } from './resource-types.ts';
import { HtmlResourceType } from './resource-types.ts';
import {
  DEFAULT_REDIRECT_STATUS,
  findRedirectCycles,
  isRedirectRoutingRule,
  normalizeRoutingPath,
  parseRedirectStatusCode,
  validateRedirectTarget,
  type HostRoutingRule,
} from './host-routing-validation.ts';
import type { LocalPath } from './paths.ts';
import {
  CAPTURE_SERVING_PREFIX,
  PARTIAL_WRITE_SUFFIX,
  RealmPaths,
  ensureTrailingSlash,
  isCaptureServingPath,
  isPartialWritePath,
  join,
  partialWritePath,
} from './paths.ts';
import type ms from 'ms';
import {
  CAPTURE_URL_TOKEN_PARAM,
  CAPTURE_URL_TOKEN_SCOPE,
  CAPTURE_URL_TOKEN_TTL,
  CAPTURE_URL_TOKEN_TTL_MS,
  MAX_CAPTURE_URLS_PER_SIGNING_REQUEST,
  captureURLTokenBinding,
  captureURLTokenSecret,
  type CaptureURLTokenClaims,
} from './capture-url-token.ts';
import {
  DEFAULT_AUDIO_SIZE_LIMIT_BYTES,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  DEFAULT_VIDEO_SIZE_LIMIT_BYTES,
} from './constants.ts';
import {
  persistFileMeta,
  removeFileMeta,
  getCreatedTime,
  getContentMeta,
  getFileMetaForPaths,
} from './file-meta.ts';
import {
  systemError,
  notFound,
  notIndexedYet,
  notAcceptable,
  methodNotAllowed,
  badRequest,
  CardError,
  responseWithError,
  formattedError,
  stringifyErrorForLog,
  unsupportedMediaType,
  type SerializedError,
} from './error.ts';
import { formatRFC7231 } from 'date-fns';
import {
  isCardResource,
  isModuleResource,
  executableExtensions,
  hasExecutableExtension,
  isNode,
  logger,
  fetchRealmPermissions,
  isSessionRevoked,
  isRealmArchived,
  baseRealm,
  SESSION_TOKEN_TTL,
  maybeURL,
  insertPermissions,
  maybeHandleScopedCSSRequest,
  isHashedScopedCSSRequest,
  parseScopedCSSRequest,
  scopedCSSInjectorSource,
  SCOPED_CSS_SERVING_PREFIX,
  authorizationMiddleware,
  internalKeyFor,
  unixTime,
  query,
  param,
  dbExpression,
  dbAdapterQuerier,
  mintRealmLoaderEpoch,
  type Querier,
  type CodeRef,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
  type DBAdapter,
  type Job,
  type QueuePublisher,
  type FileMeta,
  type DirectoryMeta,
  type ResolvedCodeRef,
  type RealmPermissions,
  type RealmAction,
  type LintArgs,
  type LintResult,
  codeRefFromInternalKey,
  codeRefWithAbsoluteIdentifier,
  isResolvedCodeRef,
  userInitiatedPriority,
  systemInitiatedPriority,
  userIdFromUsername,
  isCardDocumentString,
  isSingleCardDocument,
  isBrowserTestEnv,
  unresolveResourceInstanceURLs,
  fileMetaTimestamps,
  type IndexedFile,
  type LooseCardResource,
  type FileMetaResource,
} from './index.ts';
import {
  canonicalizeTarget,
  newOperationScope,
  resolveOperation,
  runOperation,
} from './card-operations/dispatch.ts';
import type {
  OperationCore,
  OperationScope,
  OperationStoredFile,
  OperationStoredFileMeta,
} from './card-operations/dispatch.ts';
import {
  assertTravelsInEnvelope,
  atEntry,
  batchEntryFor,
  carriesOperationsExt,
  errorsDocument,
  invocationsIn,
  isWrite,
  needsActor,
  paramsFor,
  parseOperationsEnvelope,
  readResult,
  resultsTree,
  stagedTree,
  targetFor,
  writeResult,
  type EnvelopeEntry,
  type EnvelopeResult,
  type ResolvedEnvelopeEntry,
} from './card-operations/envelope.ts';
import {
  OperationFailure,
  isDocumentResult,
  isHeadResult,
  isOperationFailure,
  isSourceResult,
  type EntryPosition,
  type OperationRequest,
  type OperationResult,
  type OperationSourceResult,
} from './card-operations/types.ts';
import { erroredTargetRow } from './card-operations/read.ts';
import { commitBatch } from './card-operations/coordinator.ts';
import type {
  BatchCore,
  BatchEntryResult,
} from './card-operations/coordinator.ts';
import type { BatchEntry } from './card-operations/executors.ts';
import type {
  DeferredPrerenderHtml,
  FromScratchResult,
  IncrementalChange,
} from './tasks/indexer.ts';
import { isCodeRef } from './code-ref.ts';
import { merge } from 'lodash-es';
import { inferContentType } from './infer-content-type.ts';
import {
  fileContentToText,
  fileContentToBytes,
  readFileAsText,
  getFileWithFallbacks,
  type TextFileRef,
} from './stream.ts';
import { transpileJS } from './transpile.ts';
import type { Method, RouteTable } from './router.ts';
import {
  ArchivedRealmError,
  AuthenticationError,
  AuthenticationErrorMessages,
  AuthorizationError,
  Router,
  SupportedMimeType,
  lookupRouteTable,
} from './router.ts';
import { parseQuery } from './query.ts';
import type { Readable } from 'stream';
import { createResponse } from './create-response.ts';
import { decodeLintFilename, LINT_FILENAME_HEADER } from './lint-headers.ts';
import stableStringify from 'safe-stable-stringify';
import {
  captureOutputContentType,
  captureSpecHash,
  captureSpecOverrides,
  isValidScreenshotName,
  parseCaptureSpecParams,
  screenshotLedgerSourceURL,
  screenshotsMetaFromManifest,
  type CaptureContentType,
  type CaptureSpec,
  type ScreenshotManifest,
  type ScreenshotManifestEntry,
} from './capture-spec.ts';
import {
  findMediaCacheEntry,
  putMedia,
  type MediaCacheAdapter,
  type MediaCacheEntryKey,
} from './media-cache.ts';
import {
  mediaCacheMissResponse,
  serveMediaCacheEntry,
  mediaCacheVisibility,
  MEDIA_CACHE_MAX_AGE_SECONDS,
} from './media-cache-serving.ts';
import {
  enqueueScreenshotCardJob,
  estimateScreenshotQueueWait,
  SCREENSHOT_SYNC_WAIT_BUDGET_MS,
} from './jobs/screenshot-card.ts';
import {
  emitScreenshotPerf,
  type ScreenshotRequestPerfEvent,
} from './screenshot-perf.ts';
import {
  sanitizeLoggingCorrelationId,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
} from './prerender-headers.ts';
import { RequestTimings, type StageCursor } from './request-timings.ts';
import { emitWriteTiming } from './write-timing.ts';
import {
  type MatrixClient,
  ensureFullMatrixUserId,
  getMatrixUsername,
} from './matrix-client.ts';
import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler.ts';

import RealmPermissionChecker from './realm-permission-checker.ts';
import type {
  ResponseWithNodeStream,
  VirtualNetwork,
} from './virtual-network.ts';

import { RealmAuthDataSource } from './realm-auth-data-source.ts';
import { AliasCache } from './cache/alias-cache.ts';
import { DirectoryViewRefresher } from './directory-view-refresher.ts';
import { fetcher } from './fetcher.ts';
import { RealmIndexQueryEngine } from './realm-index-query-engine.ts';
import type { SearchResultDoc } from './realm-index-query-engine.ts';
import {
  RealmIndexUpdater,
  type IncrementalIndexMeta,
  type IndexChange,
} from './realm-index-updater.ts';
import serialize, {
  resolvedRelationshipLink,
  storedRelationshipLink,
} from './file-serializer.ts';
import {
  fileSizeLimitFor,
  validateByteLength,
  validateWriteSize,
} from './write-size-validation.ts';
import { isSplicedSource, type SplicedSource } from './spliced-content.ts';
import type { JsonValue } from './json-validation.ts';
import {
  computeContentHash,
  computeContentHashFromRanges,
  isSampledContentHash,
} from './content-hash.ts';
import { resolveFileDefCodeRef, urlNamesFile } from './file-def-code-ref.ts';

import type { Utils } from './matrix-backend-authentication.ts';
import { MatrixBackendAuthentication } from './matrix-backend-authentication.ts';

import type {
  FileWatcherEventContent,
  RealmEventContent,
  UpdateRealmEventContent,
} from '@cardstack/base/matrix-event';
import type {
  AtomicOperation,
  AtomicOperationResult,
  AtomicPayloadValidationError,
} from './atomic-document.ts';
import { filterAtomicOperations } from './atomic-document.ts';
import {
  isFilterRefersToNonexistentTypeError,
  type DefinitionLookup,
  type PopulateCoordinator,
} from './definition-lookup.ts';
import {
  fetchSessionRoom,
  upsertSessionRoom,
} from './db-queries/session-room-queries.ts';
import { REALMS_LIST_UPDATED_EVENT_TYPE } from './matrix-constants.ts';
import { createSendEvent } from './send-event.ts';
import { userExists } from './db-queries/user-queries.ts';
import {
  analyzeRealmPublishability,
  type PublishabilityViolation,
  type PublishabilityWarningType,
  type ResourceIndexEntry,
} from './publishability.ts';
import {
  cancelAllJobsInConcurrencyGroup,
  cancelRunningJobsInConcurrencyGroup,
} from './job-utils.ts';

export const REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME = 60 * 60 * 1000;

// The realm's settings, as they arrive from the RealmConfig card at
// `realm.json` — from its stored bytes on one overlay and from its indexed
// document on the next.
//
// Called only where the attribute is present, so that the second overlay can
// clear what the first assigned, the way every other field in these two
// overlays is applied. Without that, a realm whose settings are removed would
// keep serving them from whichever overlay still carried them.
//
// A settings map is whatever JSON the realm owner wrote, so this is where the
// shape is held to the one a program can read a key out of: an object, and not
// an array or a scalar. Anything else — including an explicit null, which is
// how an owner writes "no settings" — leaves the realm with none, whichever
// overlay meets it, and a value that is not a map says so in the log rather
// than reaching `realmConfig("x")` as something that cannot be indexed by
// name.
function assignRealmConfig(
  realmInfo: RealmInfo,
  config: unknown,
  log: { warn: (message: string) => void },
): void {
  if (config === null) {
    delete realmInfo.config;
    return;
  }
  if (typeof config !== 'object' || Array.isArray(config)) {
    log.warn(
      `ignoring the RealmConfig card's \`config\`, which is ${
        Array.isArray(config) ? 'an array' : typeof config
      } rather than a map of settings`,
    );
    delete realmInfo.config;
    return;
  }
  // Copied whole rather than shallowly, because the object this is given
  // belongs to whoever produced it — the index row the overlay read, which the
  // query engine is free to hold onto — while the map made here is memoized
  // until the next index swap. Sharing a structured value between the two ties
  // their lifetimes together for no gain; a settings map is small enough that
  // copying it costs nothing.
  realmInfo.config = structuredClone(config) as Record<string, JsonValue>;
}

export interface RealmSession {
  canRead: boolean;
  canWrite: boolean;
}

export type { RealmVisibility };

export type RealmInfo = {
  name: string;
  backgroundURL: string | null;
  iconURL: string | null;
  showAsCatalog: boolean | null;
  visibility: RealmVisibility;
  realmUserId?: string;
  publishable: boolean | null;
  lastPublishedAt: string | Record<string, string> | null;
  // Realm lifecycle timestamps, from realm_registry. Served by the realm
  // server's batch `/_federated-info` only — absent from the per-realm
  // `/_info` and from the `meta.realmInfo` embedded in card responses. See
  // `Realm#getDetailedRealmInfo` for why. Optional (rather than `| null`-only)
  // so consumers reading a card's `meta.realmInfo` type-check without
  // pretending the values are there.
  //
  // The workspace-chooser tile counts are deliberately NOT here — see
  // `RealmIndexCounts` and `Realm#getIndexCounts`.
  createdAt?: string | null;
  updatedAt?: string | null;
  // The realm's own settings, which a card operation reads with
  // `realmConfig("key")`. It is on this type because the overlays that read
  // the config document assign it here alongside the realm's name — but
  // `parseRealmInfo` hands it back apart from the info it serves, so nothing
  // the realm puts on the wire carries it: not the `meta.realmInfo` stamped on
  // card and file-meta documents, and not `/_info`. `getRealmConfig()` is
  // where the operation runtime reads it.
  config?: Record<string, JsonValue>;
  // Opt-in to producing the full prerendered isolated HTML for the
  // realm's default index card (CardsGrid or Workspace). When
  // undefined / null / false the host's render route substitutes a
  // small boilerplate placeholder instead and skips the (expensive)
  // isolated render.
  // The lever is primarily set by the publish handler on the
  // published realm snapshot so anonymous-visitor SSR injection has
  // real content; unpublished realms typically have nothing reading
  // the index's isolated HTML. Optional to avoid forcing every
  // RealmInfo fixture to update.
  includePrerenderedDefaultRealmIndex?: boolean | null;
};

// Counts behind a favorite workspace tile's Cards / Files / Definitions row.
// Kept out of `RealmInfo` because they're the expensive half to compute — an
// aggregate over every index row in the realm — and only favorited tiles
// render them, so the host fetches them lazily from
// `/_federated-index-counts` rather than at boot for every realm. A `null`
// means "not available" (index tables missing, or the query failed) and the
// tile drops that stat rather than showing a zero.
export type RealmIndexCounts = {
  cardCount: number | null;
  fileCount: number | null;
  definitionCount: number | null;
};

// Marker header the host SPA attaches to its outbound search calls and card
// writes when it's running inside a prerender tab. Two different host-side
// flags produce it, and the split is deliberate:
//
//   - Search calls read `__boxelRenderContext`, which the prerender server
//     injects into every Chrome tab via puppeteer's `evaluateOnNewDocument`
//     before the host loads, and which the prerender-shaped routes also
//     raise when they activate.
//   - Card writes read `__boxelHeadlessCommand`, raised only by the
//     command-runner route. Host tests raise `__boxelRenderContext` around
//     in-browser index renders that run alongside an interactive app, and a
//     save from that app must keep answering from the index — so a write
//     cannot use the broader flag. A command is the only writer in a
//     prerender tab anyway; the render routes block persistence outright.
//
// Either way the header goes on those requests only, narrowly scoped so
// non-realm-server origins (icons, vite, etc.) don't see it on a CORS
// preflight.
//
// The realm reads it as "the caller is the host SPA mid-render, and it is
// holding a prerender render slot until this request returns". Two inbound
// requests act on that:
//
//   - `_search` / `_federated-search` switch to cacheOnlyDefinitions:true,
//     short-circuiting the recursive lookupDefinition → prerenderModule path
//     in populateQueryFields that causes self-referential prerender deadlocks
//     under parallel indexing.
//   - a JSON-API card POST / PATCH indexes deferred and answers from the
//     document it serialized, because reading the write back out of the index
//     would await a job that needs the slot the caller is holding. See
//     `serializedInstanceEcho`.
//
// Kept as a bare string here so runtime-common stays independent of
// realm-server. The realm-server prerender side re-exports the same value
// from prerender-constants.ts.
export const DURING_PRERENDER_HEADER = 'x-boxel-during-prerender';
function isDuringPrerenderRequest(request: Request): boolean {
  return (request.headers.get(DURING_PRERENDER_HEADER) ?? '').length > 0;
}

// A request URL safe to write to a log line: the capture-URL token (a bearer
// credential carried in `?token=`) is redacted, since these lines ship to
// Loki. Mirrors the request-log middleware's `loggableRequestURL`, needed
// again here because the realm's own logger (auth-failure and capture-token
// warnings) bypasses that middleware. A no-op when no token param is present.
function maskLoggedURL(urlString: string): string {
  try {
    let url = new URL(urlString);
    if (!url.searchParams.has(CAPTURE_URL_TOKEN_PARAM)) {
      return urlString;
    }
    url.searchParams.set(CAPTURE_URL_TOKEN_PARAM, 'REDACTED');
    return url.href;
  } catch {
    return urlString;
  }
}

// Opt-in signal a JSON-API card POST / PATCH caller sets to say "don't block my
// write on the realm's in-flight incremental indexing — index deferred and
// answer me from the document I sent". This is the write-side half of what
// DURING_PRERENDER_HEADER does, without the search-path changes (cacheOnly-
// Definitions, skipQueryBackedExpansion) that header also triggers, so an
// ordinary interactive save can take it safely.
//
// Motivation: the default synchronous-indexing contract makes a single-card
// save await `incrementalIndexing()`, which resolves only once EVERY in-flight
// incremental/copy job for the realm settles — so an unrelated reindex
// draining in the worker pool can stall (and time out) the save. A caller that
// consumes the returned instance directly (e.g. SaveCardCommand) doesn't need
// the freshly-indexed read-back and can opt out.
//
// The tradeoff is narrower than full read-your-write loss. The writer's own
// next card read still waits: the deferred job is tagged with the writer
// (`initiatedBy`), and card/file reads drain the requester's own indexing
// (`drainRequestersOwnIndexing`, bounded by READ_INDEX_DRAIN_BUDGET_MS). What
// goes eventually-consistent is search — `searchEntriesResponse` has no drain,
// so _search/_federated-search can miss the write until the job lands — plus
// anonymous readers, other users' sessions, and any read that exhausts the
// drain budget.
export const SKIP_INDEX_WAIT_HEADER = 'x-boxel-skip-index-wait';
function isSkipIndexWaitRequest(request: Request): boolean {
  return (request.headers.get(SKIP_INDEX_WAIT_HEADER) ?? '').length > 0;
}

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;
  // Total byte size of `content`, when the adapter knows it without reading
  // the bytes (e.g. from the stat it already performed). Lets streamed file
  // responses carry a Content-Length, which browsers need before they will
  // treat media as seekable / of known duration.
  size?: number;
  // Open a bounded byte range of the file, [start, end] inclusive, without
  // materializing the rest. Present when the adapter can do this cheaply
  // (e.g. a bounded fs read stream); together with `size` it enables HTTP
  // Range (206) serving. Both offsets are within `size`.
  createRangeStream?: (
    start: number,
    end: number,
  ) => ReadableStream<Uint8Array> | Readable;

  [key: symbol]: object;
}

const CACHE_HEADER = 'X-Boxel-Cache';
const CACHE_HIT_VALUE = 'hit';
const CACHE_MISS_VALUE = 'miss';
// CS-11030: DB table backing the cross-process transpile cache and
// the matching budget the loser path waits before re-reading. Same
// 180 s budget as CachingDefinitionLookup's COALESCE_NOTIFY_WAIT_MS —
// prerenders + transpiles run on similar timescales; bigger budgets
// just delay the fallthrough on missed NOTIFY, smaller budgets risk
// a second transpile before the winner finishes.
const MODULE_TRANSPILE_CACHE_TABLE = 'module_transpile_cache';
const COALESCE_NOTIFY_WAIT_MS = 180_000;

// Smallest batch write that takes a hold on its realm's render lane. Below
// this the write is over in well under the time a render pass takes to start,
// so a hold could not collect anything to merge and would only add two
// queries to the path a card save takes. Editing writes a card and sometimes
// its module; an import writes hundreds at once, so the two are far apart and
// the exact line between them does not matter much.
const RENDER_HOLD_MIN_BATCH_SIZE = 10;
// How long a hold survives without a refresh. A holder that dies mid-write
// costs the lane this much idleness, so it wants to be short; a refresh that
// loses a race with a slow query must not drop the hold, so it wants to be
// comfortably longer than the refresh interval.
const RENDER_HOLD_LEASE_MS = 30_000;
const RENDER_HOLD_REFRESH_MS = 10_000;
// Longest an unbroken run of holds may keep the lane held. Holds chain across
// consecutive commits on purpose, so without a cap a realm taking bulk commits
// back to back could keep its HTML from ever being rendered. Read per call,
// not once at import, so the ceiling can be tuned — or shortened to something
// a test can reach — without a restart.
const DEFAULT_RENDER_HOLD_MAX_MS = 5 * 60_000;
function renderHoldMaxMs(): number {
  let override = Number(
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.RENDER_HOLD_MAX_MS,
  );
  return Number.isFinite(override) && override > 0
    ? override
    : DEFAULT_RENDER_HOLD_MAX_MS;
}
// `localPath`s (no leading slash) exempt from the archived-realm seal: the
// realm's public operational endpoints, which must keep working while a realm
// is archived. `_readiness-check` is the health probe; `_session` is the
// authentication endpoint. Matched on path rather than `Accept`/`Content-Type`
// so the exemption holds for header-less probes too. Keep in sync with
// `#publicEndpoints`.
const ARCHIVED_SEAL_EXEMPT_PATHS = new Set(['_readiness-check', '_session']);
// How long one `_readiness-check` request holds while the gates it clears
// settle, before answering not-ready instead. Shared across those gates rather
// than granted per gate: the hold is a courtesy to the poller, `Retry-After`
// already tells it to come back, and a hold longer than a caller's per-attempt
// deadline yields a connection timeout instead of a status the loop can read.
// Sized to the same per-attempt deadline the index-lane budget is sized to.
// `awaitPrerenderHtml` readiness gates on rendered HTML after this budget and
// carries its own, longer one — a published realm's HTML can take minutes and
// its callers are pollers with deadlines to match.
const READINESS_REQUEST_BUDGET_MS = 10_000;
// How long the readiness lane gate will spend naming the jobs that held it.
// Separate from the budget above and much smaller, because it is spent after
// that budget is already gone: it buys a log line, not an answer, so it is
// sized to be lost in the noise of a request that has already held for 10s.
const LANE_DIAGNOSTIC_BUDGET_MS = 1_000;
// How long a card read holds its connection on the read-your-writes indexing
// drain (see `drainRequestersOwnIndexing`) before serving the current index
// generation anyway. Bounded for the same reason the readiness gates are: an
// unbounded hold is worse than a slightly stale answer. The index stays
// consistent throughout — incremental jobs write into the working table and
// only swap on completion — so a read that outlives the budget serves the
// previous generation, and the index event that follows the swap refreshes
// live clients.
const READ_INDEX_DRAIN_BUDGET_MS = 10_000;
const MODULE_ETAG_VARIANT = 'module';
const SOURCE_ETAG_VARIANT = 'source';
// How long a conditional write waits for the realm's indexing lane before it
// gives up and refuses, and how often it re-asks while waiting.
//
// Much shorter than the budget a readiness probe takes, because this one waits
// with the batch's file locks held and each poll takes a pool client while the
// lock already pins one. Every other writer of those files is queued behind
// it, so the wait spends their latency to answer this request — and the 503 it
// ends in invites a retry that takes the locks again.
//
// The scope is narrower than the wait: the locks cover the files this batch
// names, but what it waits for is the realm's indexing lane, so a write parks
// here for work that need not touch its files at all.
//
// A long budget buys little anyway: the jobs it waits on are bounded in
// minutes, so anything that would finish inside a wait of this size was
// finishing regardless, and the `jobs_finished` subscription delivers the
// wakeup rather than the poll. The poll is the backstop, so it is sized to the
// budget rather than left at a default that would fire only a few times inside
// it.
const CONDITIONAL_WRITE_INDEX_SETTLE_BUDGET_MS = 1_000;
const CONDITIONAL_WRITE_INDEX_SETTLE_POLL_MS = 250;

// Card+JSON ETag is `"<indexed_at>-<realmInfoHash>[-<screenshots>]:card"`
// — quoted per RFC 9110 §8.8.3 so CDNs / browsers don't re-quote inbound
// validators and split the cache key. Three inputs feed the base:
//   - `indexed_at` on the primary card's index row, which bumps on
//     direct writes AND dependency-triggered re-writes (so the deps
//     graph carries cascading invalidations forward through it);
//   - md5 of the cached `RealmInfo`, since `attachRealmInfo()`
//     injects `meta.realmInfo` (name / icon / `lastPublishedAt`)
//     into the assembled response at request time and that field
//     can change without any card being re-indexed;
//   - a fingerprint of the joined screenshot manifest, which lands on
//     the prerendered_html channel without moving `indexed_at` (see
//     `screenshotsEtagFingerprint`).
// `buildCardJsonEtag()` constructs the value; cards with foreign-
// realm instance deps suppress emission entirely because cross-realm
// invalidation doesn't cascade `indexed_at` today.
//
// Bump this variant whenever the served card-JSON representation changes so
// caches revalidate instead of 304'ing a client to a stale body: neither
// `indexed_at` nor the realm-info hash moves on a serialization change, so the
// variant is the only signal that invalidates already-cached bodies. Bumped to
// `card-rri` when the server began serving instance ids (`id`/`links.self`/
// relationship ids) in canonical prefix (RRI) form for mapped realms.
const CARD_JSON_ETAG_VARIANT = 'card-rri';

// The variant the card+json validator carries, with the assembled-resource
// budget folded in. The budget decides which cards come back with a clipped
// closure and what a clipped one contains, and it is settable per server, so
// changing it changes bodies while `indexed_at`, the realm-info hash and the
// screenshots fingerprint all stand still. That is the case the constant above
// exists for, except that the change arrives by configuration rather than by
// revision — so the value belongs in the validator rather than in the memory of
// whoever edits it. One number for the process, so it fragments no cache: every
// response at a given build and setting shares it.
function cardJsonEtagVariant(): string {
  return `${CARD_JSON_ETAG_VARIANT}-lb${assembledLinkResourceBudget()}`;
}

// Postgres NOTIFY channel for cross-instance invalidation of #sourceCache /
// #transpiledModuleCache entries on file writes. Two payload shapes:
//
//   `<realmURL>:<path>` — invalidate a single path's cached source +
//      (for executable extensions) module entry. Emitted by every
//      single-file write/delete via Realm.#notifyFileChange. Receiver
//      calls Realm.invalidateCache(path).
//   `<realmURL>:*`      — bulk-invalidate every cached path for this
//      realm. Emitted by the publish-realm / unpublish-realm /
//      delete-realm handlers after the FS swap or removal, so peer
//      replicas (which do NOT receive the file-watcher events that
//      drive single-file invalidation in-process) drop pre-swap bytes
//      from `#sourceCache` / `#transpiledModuleCache` before serving the next
//      source read. Receiver calls Realm.clearLocalSourceCaches(). See
//      CS-11156. (`*` is reserved as the wildcard sentinel; real
//      LocalPath values never contain it.)
//
// See docs/db-authoritative-realm-registry.md §6 "Cache invalidation channel"
// and §9 "Cache-invalidation NOTIFY missed" for the semantics (best-effort,
// missed-NOTIFY is a cache-staleness window, not data corruption).
export const REALM_FILE_CHANGES_CHANNEL = 'realm_file_changes';
export const REALM_FILE_CHANGES_WILDCARD = '*';

// CS-11119: Postgres NOTIFY channel announcing that a realm's read-side
// derived caches (`#inFlightSearch`, `#cachedRealmInfo`) must drop.
// Payload is the realm URL.
//
// Distinct from REALM_FILE_CHANGES_CHANNEL (which fires at file-WRITE
// time, before indexing has run). Originally introduced for INDEX-UPDATE
// fan-out — emitted after the worker's batch.done() committed
// boxel_index — but the receiver also drops `#cachedRealmInfo`, which is
// derived from `realm_permissions`. CS-11178 extends the publisher list
// so a `realm_permissions` write (`patchRealmPermissions`) fires the
// same NOTIFY: peers drop their cached RealmInfo (whose `visibility`
// field is permissions-derived) and an unrelated in-flight searchCards
// pays at most one extra DB round-trip — admin-rare PATCHes make the
// over-invalidation negligible. If a future caller needs to invalidate
// permissions-derived state without touching index-derived state,
// introduce a dedicated `realm_permissions_changed` channel.
//
// Same best-effort semantics as the other realm-server NOTIFY channels: a
// missed NOTIFY leaves a bounded staleness window (one in-flight
// searchCards walk plus a stale RealmInfo on `_info` until the next swap
// or write), not data corruption.
export const REALM_INDEX_UPDATED_CHANNEL = 'realm_index_updated';

// What an index pass reports back to the write paths that drive it.
interface IndexPassResult extends IncrementalIndexMeta {
  invalidations: string[];
}

// Accumulates the type sets of every index pass standing behind one
// broadcast — a `writeMany` flushes modules ahead of the instances that depend
// on them, so a single event can cover several passes. A pass that couldn't
// report its types poisons the accumulation for good rather than being skipped
// over: the event speaks for every pass behind it, and a set that quietly
// omitted one would let a subscriber sit out a re-run it needed.
function makeInvalidatedTypeAccumulator() {
  let types: Set<string> | undefined = new Set();
  return {
    add(meta: IncrementalIndexMeta): void {
      if (meta.invalidatedTypes === undefined) {
        types = undefined;
      } else if (types) {
        for (let type of meta.invalidatedTypes) {
          types.add(type);
        }
      }
    },
    get value(): string[] | undefined {
      return types ? [...types] : undefined;
    },
  };
}

// What this field may add to an event, encoded. It bounds this member's own
// contribution and nothing else: `invalidations` carries no ceiling, so it is
// what decides whether a large fan-out's event is deliverable at all, and a
// budget here neither helps nor hurts that. What it buys is that a realm whose
// pass touches a pathological number of distinct types — where the set has
// stopped being selective enough to be worth carrying — drops the member
// instead of adding to the bulk, and its subscribers take the unconditional
// re-run they would have taken without it.
const MAX_BROADCAST_INVALIDATED_TYPES_BYTES = 8 * 1024;

function boundedInvalidatedTypes(invalidatedTypes: string[] | undefined): {
  invalidatedTypes?: string[];
} {
  if (invalidatedTypes === undefined) {
    return {};
  }
  // Measure what goes on the wire — the JSON encoding, not the character
  // count of the strings inside it.
  let encodedLength = new TextEncoder().encode(
    JSON.stringify(invalidatedTypes),
  ).length;
  if (encodedLength > MAX_BROADCAST_INVALIDATED_TYPES_BYTES) {
    return {};
  }
  return { invalidatedTypes };
}

// Emit `NOTIFY realm_index_updated, '<realmURL>'`. Called from every
// post-update site inside Realm (Realm.update's onInvalidation, the
// deferred variant, and Realm.fullReindex). Adapters without pub/sub
// (e.g. SQLite in the host/browser context) implement notify as a no-op.
export async function notifyRealmIndexUpdated(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<void> {
  try {
    await dbAdapter.notify(REALM_INDEX_UPDATED_CHANNEL, realmURL);
  } catch (err: unknown) {
    logger('realm').warn(
      `notify ${REALM_INDEX_UPDATED_CHANNEL} failed for ${realmURL}: ${String(err)}`,
    );
  }
}

// Emit a bulk `<realmURL>:*` NOTIFY on the `realm_file_changes` channel so
// peer realm-server replicas drop every cached path for this realm. Use
// directly when the caller has a DBAdapter + realm URL but isn't keeping
// the realm running locally (the unpublish-realm and delete-realm
// handlers — the realm is about to be torn down, so this replica's own
// in-process cache will be garbage-collected with the Realm instance).
// When the caller wants the SAME local cache wipe AND the broadcast
// — i.e. its own next read must not hit pre-swap bytes — call
// `Realm.clearLocalSourceCachesAndBroadcast()` instead. Same best-effort
// semantics as `Realm.#notifyFileChange`: failures are logged and
// swallowed (missed NOTIFY is a bounded staleness window, not data
// corruption). See CS-11156.
export async function notifyAllFileChanges(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<void> {
  try {
    await dbAdapter.notify(
      REALM_FILE_CHANGES_CHANNEL,
      `${realmURL}:${REALM_FILE_CHANGES_WILDCARD}`,
    );
  } catch (err: unknown) {
    logger('realm').warn(
      `notify ${REALM_FILE_CHANGES_CHANNEL} (bulk) failed for ${realmURL}: ${String(err)}`,
    );
  }
}

export const FILE_META_RESERVED_KEYS = new Set([
  'name',
  'url',
  'sourceUrl',
  'contentType',
  'contentHash',
  'contentSize',
  'lastModified',
  'createdAt',
]);

type CachedSourceFileEntry = {
  type: 'file';
  ref: FileRef;
  defaultHeaders: Record<string, string>;
  canonicalPath: LocalPath;
  // Content fingerprint of the materialized body, computed once on cache
  // populate. Used
  // as the ETag base so two writes within the same unix second still
  // produce distinct ETags — see `buildEtag` for the rationale.
  contentHash: string | undefined;
};

type CachedSourceRedirectEntry = {
  type: 'redirect';
  status: number;
  headers: Record<string, string>;
  canonicalPath: LocalPath;
};

type SourceCacheEntry = CachedSourceFileEntry | CachedSourceRedirectEntry;

type TranspiledModuleEntry = {
  canonicalPath: LocalPath;
  body: string;
  headers: Record<string, string>;
  dependencyKeys: Set<string>;
};

// Who a dispatched operation runs for, as `#callerOf` derives it from a
// request. It travels on its own wherever an operation is reached from work
// that outlives the request that started it.
type OperationCaller = Pick<OperationRequest, 'actor' | 'clientRequestId'>;

type ModuleLoadResult =
  | { kind: 'not-found'; response: ResponseWithNodeStream }
  | { kind: 'non-module'; response: ResponseWithNodeStream }
  | { kind: 'shimmed'; response: ResponseWithNodeStream }
  | {
      kind: 'not-modified';
      canonicalPath: LocalPath;
      headers: Record<string, string>;
    }
  | ModuleTranspileResult;

type ModuleTranspileResult = {
  kind: 'module';
  canonicalPath: LocalPath;
  body: string;
  headers: Record<string, string>;
  // Computed once at the transpile/L2-hit boundary so fallbackHandle's L1
  // write can reuse them instead of re-running extractModuleDependencyKeys
  // on every L1 miss. Carried through the L2 row so a cross-process L2 hit
  // also skips the AST scan.
  dependencyKeys: Set<string>;
};

// ETag base prefers a content fingerprint (derived from the file body) over
// `lastModified` because the unix-second timestamp collides for two
// writes that land in the same second — and `cachedFetch` (loader →
// cached-fetch) will then serve a stale 304-cached body. We compute the
// content hash on the cache-miss path of the source endpoint, where the
// content is already being materialized into memory, and stash it on the
// cache entry so subsequent serves reuse it. Adapters that don't yet
// surface a content fingerprint fall back to `lastModified` and keep the
// pre-existing behavior.
//
// An `etagBase` must be a TOTAL identity of the body, because displacing
// `lastModified` gives up the only signal that sees every write. A sampled
// fingerprint (see `computeContentHash`) is not total — it cannot see a large
// file's middle — so it is joined with `lastModified` rather than replacing
// it: the hash resolves two writes inside one second, and the timestamp
// covers a same-length middle-only edit the hash misses. An mtime-only touch
// then busts the cache, which is the safe direction and already how every
// file without a fingerprint behaves.
// Joins a sampled fingerprint with the file's mtime so the ETag base is a
// total identity again. Returns a whole fingerprint unchanged, and undefined
// when there is none (the caller then falls back to mtime alone).
function totalEtagBase(
  etagBase: string | undefined,
  lastModified: number | undefined,
): string | undefined {
  if (etagBase == null) {
    return undefined;
  }
  if (lastModified == null || !isSampledContentHash(etagBase)) {
    return etagBase;
  }
  return `${etagBase}:${lastModified}`;
}

function buildEtag(
  base: string | number | undefined,
  variant?: string,
): string | undefined {
  if (base == null) {
    return undefined;
  }
  let baseStr = String(base);
  return variant ? `${baseStr}:${variant}` : baseStr;
}

// Card+JSON ETag = `"<indexed_at>-<realmInfoHash>[-<screenshotsFingerprint>]:card"`.
// The value is wrapped in double quotes to satisfy RFC 9110 §8.8.3 — CDNs and
// browsers don't re-quote inbound validators and an unquoted token
// would fail strict-validator parsing in some intermediaries.
// `indexedAt` captures direct + dep-cascaded writes; the
// `realmInfoHash` captures `attachRealmInfo()`'s request-time
// injection of `meta.realmInfo` (which can flip without re-indexing
// any card); the screenshots fingerprint captures the joined
// `meta.screenshots` (see `screenshotsEtagFingerprint`). A null
// `indexedAt` suppresses ETag emission entirely.
//
// How much of a card's link graph a card+json body carries. `full` side-loads
// the whole closure; `links-only` answers the relationships without
// side-loading their targets; `write-echo` is what a POST / PATCH returns —
// the written card alone, neither its links resolved nor its query-backed
// fields expanded, because nothing reads either off a write response.
//
// These three take different validators because a client holding one must not
// be 304'd to another's body. The `full` shape splits once more below, on
// whether the assembled-resource budget bounded the closure it carries, since
// a bounded body and an exempt one differ at one `indexed_at`. Query-backed
// expansion gets no member here: a read from inside a prerender leaves those
// fields unexpanded, but that body is never served to a client that caches,
// and the response cache separates it by folding `skipQueryBackedExpansion`
// into its own key rather than into the ETag. Adding a member here is the
// wrong move for a variation the validator does not have to carry.
//
// Listed as values as well as a union, so a reader that must cover every shape
// can enumerate them rather than restate the list. A conditional write is such
// a reader — it compares a caller's validator against every one the realm
// could have issued for the card — and a shape it does not know about is a
// validator it would refuse for no reason the caller can see. Note that
// covering the shapes is not on its own covering the validators: the `full`
// split above is a second dimension, so a reader enumerates the arguments
// `buildCardJsonEtag` takes rather than this list alone.
const CARD_JSON_SHAPES = ['full', 'links-only', 'write-echo'] as const;
type CardJsonShape = (typeof CARD_JSON_SHAPES)[number];

function buildCardJsonEtag(
  indexedAt: number | null | undefined,
  realmInfoHash: string | undefined,
  screenshotsFingerprint?: string,
  shape: CardJsonShape = 'full',
  unboundedAssembly = false,
): string | undefined {
  if (indexedAt == null) {
    return undefined;
  }
  let base = [`${indexedAt}`, realmInfoHash, screenshotsFingerprint]
    .filter(Boolean)
    .join('-');
  // A response that carries less of the card's link graph than a full read
  // serves a different representation of the same card at the same
  // `indexed_at`, so it takes its own variant — the same job the constant
  // does for a serialization change, on a value that varies per response
  // rather than per revision. Without it, a client that cached a narrower
  // shape would be 304'd to it when it later asks for the full one, and the
  // shapes would be reachable under one key in the response cache.
  //
  // A full read is the only shape that assembles a link closure, so it is the
  // only one the assembled-resource budget can move — and it splits again on
  // whether that budget applied. An assembly exempt from the budget carries its
  // whole closure at any ceiling, so it is named as such rather than by a
  // number that does not bind it: naming the exemption leaves an exempt
  // response's validator untouched by a retune, which cannot change its body,
  // and keeps the two shapes from sharing a validator — which would let a
  // conditional request be answered with the other shape's body. That is the
  // hazard the exemption exists to prevent, since an exempt read is a render's,
  // and a clipped closure reused by one is baked into cached HTML.
  let variant: string;
  if (shape !== 'full') {
    variant = `${CARD_JSON_ETAG_VARIANT}-${shape}`;
  } else if (unboundedAssembly) {
    variant = `${CARD_JSON_ETAG_VARIANT}-lb-off`;
  } else {
    variant = cardJsonEtagVariant();
  }
  return `"${base}:${variant}"`;
}

// The joined `meta.screenshots` travels on the prerendered_html channel,
// which publishes after — and independently of — the index row: `indexed_at`
// does not move when a capture lands, so a validator built from it alone
// would 304 a cached document past its own screenshots forever (the same
// two-channel trap `buildEntryEtag` documents below). Folding a fingerprint
// of the manifest in rotates the validator exactly when the served
// `meta.screenshots` changes — objectKeys are content hashes, so a re-render
// whose captures are byte-identical keeps its fingerprint. Absent manifest
// contributes no component, so cards without captures keep their validators.
function screenshotsEtagFingerprint(
  manifest: ScreenshotManifest | null | undefined,
): string | undefined {
  if (!manifest) {
    return undefined;
  }
  return computeContentHash(stableStringify(manifest) ?? '').slice(0, 8);
}

// The card+html / file-meta+html GET's composite validator. It encodes both
// channels the response draws from: the entry's index-data generation and the
// rendering's generation — or `none` when no rendering is present — so the
// validator changes when EITHER advances. An ETag of the rendering generation
// alone breaks the refresh flow: a client that cached the no-rendering response
// at index generation 42 would send a validator that still matches after HTML
// lands at 42 and would 304 forever. The rendering generation is read off the
// entry's own `html` linkage; all of one card's renderings share a generation
// (it's a per-row value), so the first referenced `html` resource stands for
// the channel.
//
// When the response carries an `item`, its serialization also rides
// `meta.realmInfo` — which can change without reindexing the card (realm
// rename / icon / publish) and so advances neither generation. So fold the
// realm-info hash in for item-bearing responses, exactly as the card+json GET
// does, or a validator would pin the stale realmInfo across such a change. A
// pure-html response carries no realmInfo, so its validator stays the clean
// index:html composite.
// An item whose links were answered but not side-loaded is a different
// serialization at the same two generations, so it takes its own validator for
// the same reason the card+json variant does: without one, turning the setting
// on or off would 304 every client holding a validator back to the shape it
// cached. A pure-html response carries no item, so its validator is unaffected.
function buildEntryHtmlEtag(
  doc: EntrySingleDocument,
  realmInfoHash: string | undefined,
  resolveLinksOnly = false,
  unboundedAssembly = false,
): string {
  let indexGeneration = doc.data.meta?.generation ?? 0;
  let htmlIds = doc.data.relationships.html?.data ?? [];
  let htmlGeneration: number | undefined;
  if (htmlIds.length > 0) {
    let firstId = htmlIds[0].id;
    let htmlResource = doc.included?.find(
      (resource): resource is HtmlResource =>
        resource.type === HtmlResourceType && resource.id === firstId,
    );
    htmlGeneration = htmlResource?.meta?.generation;
  }
  let base = `${indexGeneration}:${htmlGeneration ?? 'none'}`;
  if (doc.data.relationships.item && realmInfoHash) {
    base = `${base}:${realmInfoHash}`;
  }
  if (doc.data.relationships.item && resolveLinksOnly) {
    base = `${base}:links-only`;
  }
  // An item carries a link closure, and the assembled-resource budget decides
  // how much of one — so a response bearing an item is a different body at a
  // different budget while both generations stand still. This validator has no
  // constant component to hang that on the way the card+json one does, so the
  // budget is folded in directly. A pure-html response assembles no closure, and
  // neither does a links-only item, so neither carries the component. An item
  // assembled exempt from the budget carries its whole closure at any ceiling,
  // so it is named as such rather than by a number that does not bind it —
  // which is also what keeps it from sharing a validator with the bounded shape.
  if (doc.data.relationships.item && !resolveLinksOnly) {
    base = unboundedAssembly
      ? `${base}:lb-off`
      : `${base}:lb${assembledLinkResourceBudget()}`;
  }
  return `"${base}"`;
}

// RFC 9110 §13.1.2: `If-None-Match` may be `*`, a comma-separated
// list of validators, and individual entries may be weak (`W/`-
// prefixed). For GET we don't distinguish weak vs. strong (spec
// says weak comparison is fine for non-range requests), so strip
// the `W/` prefix on *both* sides and compare the bare quoted
// values — a server-emitted weak ETag must still match an echoed
// `If-None-Match: W/"..."` from the client.
export function ifNoneMatchMatches(headerValue: string, etag: string): boolean {
  let value = headerValue.trim();
  if (value === '*') {
    return true;
  }
  let normalizedEtag = etag.replace(/^W\//, '');
  return value
    .split(',')
    .some((token) => token.trim().replace(/^W\//, '') === normalizedEtag);
}

// A handle's content fingerprint, read in bounded ranges rather than by
// streaming the file.
//
// The cost is bounded by the fingerprint's own shape:
// `computeContentHashFromRanges` asks for min(size,
// `CONTENT_HASH_WHOLE_LIMIT_BYTES`) — the whole content up to that limit, and
// a fixed head and tail above it. So the read has a ceiling no file can
// exceed rather than a flat cost, and the value is the same one hashing the
// whole content would produce.
//
// Nothing here touches `content`. That keeps this off the handle a body is
// served from, which matters twice: `content` is a lazy getter on every
// streaming adapter, so reading it here would strand a stream for a
// headers-only read, and it is single-use, so it would take the bytes a full
// read is about to return. Both modes therefore reach the same fingerprint at
// the same cost, and neither pays for the other's.
//
// Undefined rather than an unbounded read where the adapter cannot serve a
// range or does not know the size without reading the bytes: a bounded read
// is worth a validator and an unbounded one is not, so an adapter declares
// the bounded read by implementing `createRangeStream` and the value is
// simply absent for one that does not.
async function contentHashFromRanges(
  file: Pick<FileRef, 'size' | 'createRangeStream'>,
): Promise<string | undefined> {
  let { size, createRangeStream } = file;
  if (size === undefined || !createRangeStream) {
    return undefined;
  }
  try {
    return await computeContentHashFromRanges(size, async (start, length) => {
      let bytes = await fileContentToBytes({
        // `createRangeStream` bounds are inclusive on both ends.
        content: createRangeStream(start, start + length - 1),
      });
      if (bytes.length !== length) {
        // The file is no longer the one `size` describes, and a fingerprint
        // built from a file that moved under the read identifies neither
        // version of it.
        throw new Error(
          `read ${bytes.length} of ${length} bytes at offset ${start}: content changed while hashing`,
        );
      }
      return bytes;
    });
  } catch {
    // Every consumer of a version handles its absence, so a failed read costs
    // the validator rather than the response the bytes are for.
    return undefined;
  }
}

// Cheap helper for the source endpoint: returns the content fingerprint of the
// body when the ref has already been materialized to a string or Uint8Array.
// Returns undefined for stream refs (the caller falls back to lastModified).
function contentHashFromMaterializedRef(ref: FileRef): string | undefined {
  let { content } = ref;
  if (typeof content === 'string' || content instanceof Uint8Array) {
    try {
      return computeContentHash(content);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Normalizes a timestamp column to an ISO string. pg hands back a
// `timestamp` as a native Date; the sqlite adapter returns it as text. An
// unparseable value yields null rather than the "Invalid Date" a bare
// `toISOString()` would throw on.
function toISOStringOrNull(value: string | Date | null): string | null {
  if (value == null) {
    return null;
  }
  let date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// One bounded range of a stored file, as bytes. The ranges a fingerprint is
// assembled from are at most `CONTENT_HASH_WHOLE_LIMIT_BYTES` wide however
// large the file is, so this holds a bounded amount however large the file is.
async function readRangeBytes(
  adapter: RealmAdapter,
  path: LocalPath,
  start: number,
  length: number,
): Promise<Uint8Array> {
  let chunks: Uint8Array[] = [];
  let total = 0;
  for await (let chunk of adapter.readRange(path, start, start + length)) {
    chunks.push(chunk);
    total += chunk.length;
  }
  if (total !== length) {
    // A short read means the file is no longer the file the caller measured,
    // and a fingerprint assembled from it would describe content of one length
    // under a marker claiming another — a version that identifies nothing. The
    // caller persists this value, so there is no later point at which a wrong
    // one is noticed.
    throw new Error(
      `expected ${length} bytes at offset ${start} of ${path}, read ${total}`,
    );
  }
  let bytes = new Uint8Array(total);
  let offset = 0;
  for (let chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// Which ceiling a write is held to. A card's `.json` and a description of one
// are both cards; everything else is a file. Read once here so what a batch is
// held to before it commits is what the commit applies.
function writeSizeType(
  localPath: LocalPath,
  content: WriteContent,
): 'card' | 'file' {
  if (isSplicedSource(content)) {
    return 'card';
  }
  return localPath.endsWith('.json') &&
    typeof content === 'string' &&
    isCardDocumentString(content)
    ? 'card'
    : 'file';
}

// Why a path is not a caller's to write to, or undefined when it is. Both
// reservations answer here so every surface that chooses a write destination —
// a direct write, an `/_atomic` operation, a batch entry — refuses the same
// set. Removals stay admitted everywhere: they are the recovery path for
// anything already stored under either name.
function reservedWriteDestination(localPath: LocalPath): string | undefined {
  if (isCaptureServingPath(localPath)) {
    return (
      `'${CAPTURE_SERVING_PREFIX}' is reserved for serving captures and ` +
      `cannot be written to`
    );
  }
  if (isPartialWritePath(localPath)) {
    return (
      `'${PARTIAL_WRITE_SUFFIX}' names a file the realm is part-way through ` +
      `writing, and cannot be written to`
    );
  }
  return undefined;
}

function computeContentSize(content: string | Uint8Array): number {
  if (content instanceof Uint8Array) {
    return content.byteLength;
  }
  return new TextEncoder().encode(content).byteLength;
}

async function computeContentSizeFromRef(
  ref: FileRef,
): Promise<number | undefined> {
  try {
    let content = ref.content;
    if (typeof content === 'string' || content instanceof Uint8Array) {
      return computeContentSize(content);
    }
    let bytes = await fileContentToBytes({ content });
    return computeContentSize(bytes);
  } catch {
    return undefined;
  }
}

async function computeContentHashFromRef(
  ref: FileRef,
): Promise<string | undefined> {
  try {
    let content = ref.content;
    if (typeof content === 'string' || content instanceof Uint8Array) {
      return computeContentHash(content);
    }
    let bytes = await fileContentToBytes({ content });
    return computeContentHash(bytes);
  } catch {
    return undefined;
  }
}

export interface TokenClaims {
  user: string;
  realm: string;
  sessionRoom: string | undefined; // TODO: remove when we create users on demand in ensureSessionRoom
  permissions: RealmPermissions['user'];
  realmServerURL: string;
  // Set on tokens minted by the realm-server's /_delegate-session endpoint
  // (CS-11552): a read-only session ai-bot uses to read a realm on behalf of
  // a user. Unlike a normal session token, a delegated token carries only
  // ['read'] even when the bound user has broader permissions, so request
  // authorization treats it specially (read-only, no exact-permissions match).
  delegated?: boolean;
}

export interface AdapterWriteResult {
  path: string;
  lastModified: number;
}

export interface AdapterAppendResult extends AdapterWriteResult {
  // The file's byte length once the append has landed. Reported by the
  // adapter because it is already holding the stat the modification time
  // above comes from, and because the alternative — asking what the file's
  // length is afterwards — is a second question about a file another writer
  // may have moved on by then. It is what the appended file's fingerprint is
  // computed against, so the two have to describe one state.
  size: number;
}

export interface FileWriteResult extends AdapterWriteResult {
  path: string;
  lastModified: number;
  created: number | null;
  // A fingerprint of the bytes now at this path, and the file's version: a
  // caller holding one can tell whether the file has moved on since, and can
  // name the base its next write is computed against. The same value is
  // persisted on the file's `realm_file_meta` row.
  contentHash: string;
}

// Everything one commit changes. Every member is optional so a caller that
// only writes, or only removes, says exactly that.
export interface CommitBatch {
  writes?: Map<LocalPath, WriteContent>;
  // Content to add to the end of a file, for a change that neither reads nor
  // rewrites what is already stored there. One entry per path holding
  // everything bound for it, so a caller adding two lines to one file adds
  // them in one append rather than reaching the file twice.
  appends?: Map<LocalPath, string | Uint8Array>;
  deletes?: LocalPath[];
}

// What a caller hands the commit for one file: the bytes themselves, or a
// description of them — a list of ranges of a stored file and the text going
// between them. The second form exists for a file too large to hold: it is
// written by streaming the ranges straight through, so a change to a file of
// any size costs the change rather than the file.
export type WriteContent = string | Uint8Array | SplicedSource;

export interface CommitBatchResult {
  // One result per staged write, in the order the caller staged them. A path
  // whose bytes were already what the caller staged is still reported here,
  // carrying the file's existing modification time and hash.
  writes: FileWriteResult[];
  // The index-data generation the commit's index pass landed on, for a caller
  // that reports it alongside the versions above. Null when nothing was
  // indexed — either because nothing changed on disk, or because the commit
  // did not wait for indexing and the generation is not known yet.
  generation: number | null;
}

export interface WriteOptions {
  clientRequestId?: string | null;
  serializeFile?: boolean | null;
  // When false, the write returns as soon as the source bytes are durable;
  // the *final* index flush kicks off in the background. Callers that need
  // to know when indexing has settled can `await realm.incrementalIndexing()`.
  // Defaults to true (preserve the synchronous-indexing semantic existing
  // callers depend on).
  //
  // Note: in a mixed-batch `writeMany` call where a module is followed by
  // an instance, the *intermediate* index flush that fileSerialization
  // depends on is still awaited inline regardless of this flag — without
  // it, the next instance's serialization would fail. This flag governs
  // only the final indexing await. `/_atomic` does write mixed batches and
  // so does reach that intermediate flush; the per-file `+source` POST and
  // the JSON-API card handlers do not, writing a single file and instances
  // respectively.
  waitForIndex?: boolean | null;
  // The matrix user whose request produced this write — the effective user
  // (post assume-user) that `checkPermission` records on the request context
  // as `authenticatedUser`. Tags the resulting incremental index job so read
  // endpoints can scope their read-your-writes drain to this user's own
  // reads. Absent for system-originated writes and for credential-less
  // writes, whose jobs no reader waits on (anonymous writes are unsupported;
  // see `drainRequestersOwnIndexing`).
  initiatingUser?: string | null;
  // Where a caller reporting where its write's time went wants this commit's
  // stages stamped. The commit drains prior indexing, makes the bytes
  // durable, queues an index job, waits for a worker to run it and then
  // invalidates what the pass touched; from outside they are one number, and
  // any of them can be the whole of a slow write. Absent, and so a no-op, for
  // every caller that is not reporting.
  stageCursor?: StageCursor;
}

export interface RealmAdapter {
  readdir(
    path: LocalPath,
    opts?: {
      create?: true;
    },
  ): AsyncGenerator<{ name: string; path: LocalPath; kind: Kind }, void>;

  openFile(path: LocalPath): Promise<FileRef | undefined>;

  // this should return unix time as it's the finest resolution that we can rely
  // on across all envs
  lastModified(path: LocalPath): Promise<number | undefined>;

  exists(path: LocalPath): Promise<boolean>;

  write(
    path: LocalPath,
    contents: string | Uint8Array,
  ): Promise<AdapterWriteResult>;

  // Replace a file's content with a rearrangement of its own bytes plus new
  // text — the form a change to a file too large to hold takes.
  //
  // The description's ranges name the file at `path` as it stands, so the
  // write's source is its own destination. Resolving that is the adapter's,
  // since only the adapter knows whether its storage can read and write one
  // path at once; what the contract requires is that the file end up holding
  // the described content, or be left as it was.
  writeSpliced(
    path: LocalPath,
    content: SplicedSource,
  ): Promise<AdapterWriteResult>;

  // Add `contents` to the end of the file at `path`, leaving everything
  // already stored there untouched and unread.
  //
  // This is the primitive an append-only change is worth having: expressing
  // one as a write means holding the file's whole content to produce the
  // content it should hold next, so adding a line to a log costs the log.
  // Here it costs the line, whatever the file's size — which is also why the
  // result reports the new length rather than a caller measuring it.
  //
  // The file is created when nothing is stored at the path, which is what
  // makes this primitive total; whether a missing target is an error is the
  // caller's question, and the operation core answers it before it gets here.
  append(
    path: LocalPath,
    contents: string | Uint8Array,
  ): Promise<AdapterAppendResult>;

  // Read `[start, end)` of a stored file. What a caller building a description
  // of a file's content reads to find the offsets it describes, and what a
  // fingerprint of a file too large to hash whole is assembled from.
  readRange(
    path: LocalPath,
    start: number,
    end: number,
  ): AsyncIterable<Uint8Array>;

  remove(path: LocalPath): Promise<void>;

  createJWT(
    claims: TokenClaims,
    expiration: ms.StringValue,
    secret: string,
  ): string;

  // throws if token cannot be verified or expired
  verifyJWT(
    token: string,
    secret: string,
  ): TokenClaims & { iat: number; exp: number };

  createStreamingResponse(
    req: Request,
    requestContext: RequestContext,
    init: ResponseInit,
    cleanup: () => void,
  ): {
    response: Response;
    writable: WritableStream;
  };

  dir?: string;

  fileWatcherEnabled: boolean;

  subscribe(cb: (message: FileWatcherEventContent) => void): Promise<void>;

  unsubscribe(): void;

  broadcastRealmEvent(
    event: RealmEventContent,
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
  ): Promise<void>;

  // optional, set this to override _lint endpoint behavior in tests
  lintStub?(
    request: Request,
    requestContext: RequestContext,
  ): Promise<LintResult>;
}

interface Options {
  // Decides how much of a card's link graph each live read carries — the whole
  // transitive closure side-loaded into `included[]`, or the relationships
  // alone with the consumer fetching what it displays. Unset, every live read
  // carries its closure, which is what a realm outside a realm-server process
  // has no load reading to decide otherwise from. Either way a prerender keeps
  // the shape it asks for, which is already narrower than both.
  linkShapePolicy?: LinkShapePolicy;
  disableModuleCaching?: true;
  copiedFromRealm?: URL;
  fullIndexOnStartup?: true;
  fromScratchIndexPriority?: number;
  // When set, the realm mounts and serves source but does not run a
  // from-scratch index on startup, even when its index is empty (new). Card
  // definitions are still resolved lazily on demand via the prerenderer, so
  // source serving and definition lookup keep working. Used by the
  // realm-server test stack, whose suite runs its own in-process realms and
  // only needs the boot realms to serve source — skipping their boot index
  // removes both the startup wait and the prerender-pool contention it would
  // otherwise create with the tests.
  skipBootIndex?: true;
  // How long a `_screenshot/` request holds its connection waiting for an
  // on-demand capture before answering 503 + Retry-After. Defaults to
  // SCREENSHOT_SYNC_WAIT_BUDGET_MS; tests shrink it to exercise the timeout
  // path without holding real time.
  screenshotSyncWaitMs?: number;
  // How long a card read (card+json / card+html GET) holds its connection
  // waiting on the requester's own in-flight incremental indexing before
  // serving the current index generation anyway. Defaults to
  // READ_INDEX_DRAIN_BUDGET_MS; tests shrink it to exercise the timeout path
  // without holding real time.
  readIndexDrainBudgetMs?: number;
}

interface UpdateItem {
  operation: 'add' | 'update' | 'removed';
  url: URL;
}

export interface MatrixConfig {
  url: URL;
  username: string;
}

export type RequestContext = {
  realm: Realm;
  permissions: RealmPermissions;
  // The effective matrix user this request runs as (post `X-Boxel-Assume-User`
  // indirection), recorded by `checkPermission` when it sees a verifiable
  // token. Undefined when the request was authorized without one — a public
  // endpoint or public-permission realm where no (valid) token accompanied
  // the request, or a realm-internal (isLocal) dispatch. Used to scope the
  // read endpoints' read-your-writes indexing drain to the requester's own
  // writes; it is identity, not authority — authorization decisions never
  // read it.
  authenticatedUser?: string;
  // Set by `checkPermission` when the request presented no Authorization
  // header at all. Anonymous writes are unsupported (no realm grants `*`
  // write in practice), so a provably credential-less caller has no
  // read-your-writes claim and the read gate skips them outright — unlike a
  // caller whose identity is merely unknown: a token that failed
  // verification, an assume-user indirection the public path cannot
  // validate, or a realm-internal dispatch that never ran `checkPermission`,
  // all of which take the conservative bounded hold. Identity, not
  // authority, like `authenticatedUser`.
  anonymous?: true;
};

export class Realm {
  #startedUp = new Deferred<void>();
  #matrixClient: MatrixClient;
  #matrixClientUserId: string;
  #realmServerURL: string;
  #realmIndexUpdater: RealmIndexUpdater;
  #realmIndexQueryEngine: RealmIndexQueryEngine;
  #operationCore: OperationCore | undefined;
  #batchCore: BatchCore | undefined;
  #adapter: RealmAdapter;
  #router: Router;
  #log = logger('realm');
  // Anchors the render-hold cap across back-to-back bulk commits; see
  // `_commitBatchUnlocked`. Undefined whenever no commit holds the lane.
  #renderHoldChainStartedAt: number | undefined;
  #renderHoldDepth = 0;
  // One line per card read that arrives while incremental indexing is
  // pending — see drainRequestersOwnIndexing for the outcome grammar.
  #readGateLog = logger('realm:read-index-gate');
  #perfLog = logger('perf');
  #updateItems: UpdateItem[] = [];
  #flushUpdateEvents: Promise<void> | undefined;
  #recentWrites: Map<string, number> = new Map();
  #realmSecretSeed: string;
  #disableModuleCaching = false;
  #linkShapePolicy: LinkShapePolicy;
  #fullIndexOnStartup = false;
  #skipBootIndex = false;
  #fromScratchIndexPriority = systemInitiatedPriority;
  #definitionLookup: DefinitionLookup;
  #copiedFromRealm: URL | undefined;
  #sourceCache = new AliasCache<SourceCacheEntry>();
  #directoryViewRefresher = new DirectoryViewRefresher(async (directory) => {
    for await (let _entry of this.#adapter.readdir(directory)) {
      // draining the listing is the whole effect; the entries are not used
    }
  });
  // Per-path generation counters for #sourceCache — the source-read analogue
  // of #transpiledModuleCacheGenerations below. getSourceOrRedirect reads
  // bytes from disk under an `await` (getFileWithFallbacks + materializeFileRef)
  // and only then calls #sourceCache.set. An invalidateCache(path) that fires
  // inside that window — e.g. a concurrent DELETE removing the file while a
  // worker's indexing fetch of the same source is still in flight — clears the
  // slot synchronously, but the in-flight read's set would otherwise re-fill it
  // with the now-deleted bytes, leaving a GET serving a file that is gone from
  // disk. The reader snapshots the generation before its first await and drops
  // its set when the generation moved. #sourceCacheGlobalGeneration covers the
  // bulk clears (__testOnlyClearCaches / clearLocalSourceCaches), which reset
  // the per-path map alongside any in-flight snapshot's `path` component.
  #sourceCacheGenerations: Map<LocalPath, number> = new Map();
  #sourceCacheGlobalGeneration = 0;
  #transpiledModuleCache = new AliasCache<TranspiledModuleEntry>();
  // CS-11028: per-path generation counters for #transpiledModuleCache. Bumped
  // synchronously by invalidateCache(path) before any await. fallbackHandle
  // snapshots at entry and discards its post-transpile cache write if the
  // path's generation moved during the in-flight transpile — otherwise the
  // pre-invalidation bytes would re-populate the slot that invalidate just
  // cleared and serve stale code until the next invalidate of that path.
  // #transpiledModuleCacheGlobalGeneration covers __testOnlyClearCaches, which wipes
  // the whole map; a snapshot taken before the wipe sees its `path`
  // component reset to 0 alongside the live counter, so a global generation
  // is the only thing that reliably mismatches afterwards.
  #transpiledModuleCacheGenerations: Map<LocalPath, number> = new Map();
  #transpiledModuleCacheGlobalGeneration = 0;
  // CS-11029: in-process inflight dedup for the transpile pipeline.
  // Concurrent same-path callers that miss #transpiledModuleCache used to each call
  // transpileJS independently — 50–500 ms of babel + ember-template-
  // compilation + decorator transforms wasted per duplicate. The map is
  // keyed by local path so the second-and-onward caller awaits the first
  // caller's promise instead of running babel again. Invalidation paths
  // (writeMany, invalidateCache, the full-index clear, etc.) drop the
  // entry through the shared #dropTranspiledModuleEntry /
  // #dropAllTranspiledModuleCacheEntries helpers so post-invalidate callers don't
  // join a stale transpile whose #transpiledModuleCache.set will be discarded by
  // CS-11028's generation guard anyway. Identity-checked cleanup on
  // settle is the same shape as CachingDefinitionLookup's #inFlight — a
  // newer pending entry installed after a drop survives an older
  // promise's eventual settle.
  #inFlightTranspiles: Map<LocalPath, Promise<ModuleTranspileResult>> =
    new Map();
  // Monotonic count of transpileJS invocations, used by the CS-11029
  // dedup tests to assert that N concurrent same-path readers triggered
  // exactly one transpile call. Reset by __testOnlyClearCaches so each
  // test reasons from a clean baseline.
  #transpileCallCount = 0;
  // Monotonic count of times the `existing` branch was taken in
  // #transpileModuleDeduped — i.e., a concurrent caller joined a
  // previously-installed in-flight promise instead of installing its
  // own. Lets the dedup tests deterministically observe "B has joined
  // A's pending" without racing on event-loop timing in CI. Reset by
  // __testOnlyClearCaches alongside #transpileCallCount.
  #transpileJoinCount = 0;
  // CS-11030: optional cross-process coalesce coordinator. When set, the
  // first realm-server in the fleet to miss the in-memory cache for a
  // given (realm_url, canonical_path) acquires an advisory lock, writes
  // the transpiled bytes to module_transpile_cache, and emits NOTIFY;
  // peers wait on NOTIFY and re-read the row instead of each running
  // babel independently. Undefined in deployments without pg (sqlite /
  // in-memory) — the realm then runs the uncoordinated CS-11029 path
  // and writes nothing to the DB cache.
  #transpileCoordinator?: PopulateCoordinator;
  #cardSizeLimitBytes: number;
  #fileSizeLimitBytes: number;
  #audioSizeLimitBytes: number;
  #videoSizeLimitBytes: number;

  #publicEndpoints: RouteTable<true> = new Map([
    [
      SupportedMimeType.Session,
      new Map([['POST' as Method, new Map([['/_session', true]])]]),
    ],
    [
      SupportedMimeType.JSONAPI,
      new Map([['GET' as Method, new Map([['/_readiness-check', true]])]]),
    ],
  ]);
  #dbAdapter: DBAdapter;
  #queue: QueuePublisher;
  #virtualNetwork: VirtualNetwork;
  #mediaCacheAdapter: MediaCacheAdapter | undefined;
  // Shared with every realm the process serves — the cache keys on absolute
  // card URLs, and one byte cap for the process is the bound that matters.
  // Absent in deployments that don't configure one (the in-browser realm),
  // where every card GET assembles its own body as before.
  #cardDocumentCache: CardDocumentCache | undefined;
  #screenshotSyncWaitMs: number;
  #readIndexDrainBudgetMs: number;
  #cachedRealmInfo: RealmInfo | null = null;
  // The `config` half of the same parse, held apart from `#cachedRealmInfo`
  // for the reason the lifecycle timestamps below are: that object is what the
  // realm serves and what the card+json ETag hashes, and these settings are
  // neither. `null` means "not yet parsed"; an empty map is a realm that
  // carries no settings, which is what an operation naming one is told.
  #cachedRealmConfig: Record<string, JsonValue> | null = null;
  // Bumped by every invalidation, and captured by a parse before it starts.
  // A parse that reads the realm's state and then has an index swap land
  // underneath it is holding values the realm has already moved past, so it
  // answers the caller who is waiting on it and stops there rather than
  // writing them into the cache — where they would be read by every later
  // operation until the next swap, and staged into cards by the ones that
  // read a setting.
  #realmInfoGeneration = 0;
  // md5 of the JSON-stringified `#cachedRealmInfo`. Folded into the
  // card+json ETag so any path that nulls `#cachedRealmInfo` (e.g.
  // invalidateCachedRealmInfo on publish/unpublish) invalidates cached
  // card responses, even though the index row's `indexed_at` doesn't
  // bump on a config change. Recomputed lazily alongside the cached
  // realm info.
  #cachedRealmInfoHash: string | null = null;
  // The in-flight `parseRealmInfo()` promise, so concurrent callers on a cold
  // cache share one read instead of each running their own. Nulled once it
  // settles (see getRealmInfo).
  #realmInfoPromise:
    | Promise<{ info: RealmInfo; config: Record<string, JsonValue> }>
    | undefined;
  // Realm lifecycle timestamps, served by `getDetailedRealmInfo` on top of the
  // plain info. Cached separately from `#cachedRealmInfo` rather than folded
  // into it, because that object is hashed into the card+json ETag and
  // `updated_at` moves on every realm write — mixing it in would bust every
  // card's cached representation whenever one card changed. A single indexed
  // `realm_registry` row lookup, so cheap enough for the boot-time batch.
  #cachedRegistryTimestamps: {
    createdAt: string | null;
    updatedAt: string | null;
  } | null = null;
  // Cards / files / definitions counts, served ONLY by the dedicated
  // `/_federated-index-counts` route — the host requests them just for the
  // realms whose tiles actually render a stats row (favorites). Kept off the
  // realm-info path because this is the expensive half: an aggregate over
  // every index row in the realm, versus a single row lookup for the
  // timestamps above.
  #cachedIndexCounts: RealmIndexCounts | null = null;
  // The in-flight `queryIndexCounts()` promise, so concurrent
  // `/_federated-index-counts` callers share one aggregate instead of each
  // running the full per-url scan. Nulled once it settles (and on index swap).
  #indexCountsPromise: Promise<RealmIndexCounts> | null = null;
  // Cached host routing map, derived from the indexed RealmConfig card.
  // `getHostRoutingMap()` is called on every host-mode index request
  // (serve-index), so re-querying the index each time is wasteful — the map
  // only changes when the realm is (re)indexed. Dropped by
  // `clearRealmIndexCaches()` alongside `#cachedRealmInfo`, which fires on
  // every index swap (full/incremental/publish) both locally and on peer
  // replicas via the realm_index_updated broadcast. `null` means "not yet
  // computed"; an empty array is a valid cached result (no routing rules).
  #cachedHostRoutingMap: HostRoutingRule[] | null = null;

  // This loader is not meant to be used operationally, rather it serves as a
  // template that we clone for each indexing operation
  readonly __fetchForTesting: typeof globalThis.fetch;
  readonly paths: RealmPaths;

  get url(): string {
    return this.paths.url;
  }

  // The one place a live read's link shape is decided, so every route that can
  // serve the same card agrees on it within one request. They have to: the
  // mode is folded into the response validator, so two routes reaching
  // different answers would hand out different validators for the same bytes,
  // and nothing about either response would look wrong on its own — which is
  // why this is a method rather than an expression repeated per route.
  //
  // Across requests the agreement is the dwell floor's, not this method's: a
  // `HEAD` and the conditional `GET` it is asked in aid of are two consults,
  // and a consult can itself move a rung, so the probe is not neutral. The
  // move pins the new level for the dwell interval, which covers the pair;
  // two reads further apart than that can straddle a rung.
  //
  // Null during a prerender: that path already skips the link-assembly pass
  // outright, so it never reaches the policy and its output stays
  // byte-identical whatever the policy decides.
  #decideLinkShape(
    request: Request,
    rowClass: LinkShapeRowClass,
  ): LinkShapeDecision | null {
    if (isDuringPrerenderRequest(request)) {
      return null;
    }
    return this.#linkShapePolicy.decide({
      realm: this.url,
      rowClass,
      requested: requestedLinkShape(
        request.headers.get(X_BOXEL_LINK_SHAPE_HEADER),
      ),
    });
  }

  get dir(): string | undefined {
    return this.#adapter.dir;
  }

  get realmServerURL(): string {
    return this.#realmServerURL;
  }

  get virtualNetwork(): VirtualNetwork {
    return this.#virtualNetwork;
  }

  constructor(
    {
      url,
      adapter,
      secretSeed,
      dbAdapter,
      queue,
      virtualNetwork,
      matrixClient,
      realmServerURL,
      definitionLookup,
      cardSizeLimitBytes,
      fileSizeLimitBytes,
      audioSizeLimitBytes,
      videoSizeLimitBytes,
      transpileCoordinator,
      mediaCacheAdapter,
      cardDocumentCache,
    }: {
      url: string;
      adapter: RealmAdapter;
      secretSeed: string;
      dbAdapter: DBAdapter;
      queue: QueuePublisher;
      virtualNetwork: VirtualNetwork;
      matrixClient: MatrixClient;
      realmServerURL: string;
      definitionLookup: DefinitionLookup;
      cardSizeLimitBytes?: number;
      fileSizeLimitBytes?: number;
      audioSizeLimitBytes?: number;
      videoSizeLimitBytes?: number;
      // CS-11030: when set, the realm coalesces concurrent cross-process
      // transpiles through an advisory-lock + NOTIFY winner/loser flow
      // and persists the resulting bytes to `module_transpile_cache` so
      // peers re-read instead of re-running babel. Optional — sqlite /
      // in-memory deployments leave this undefined and the uncoordinated
      // CS-11029 in-process dedup is the only sharing layer.
      transpileCoordinator?: PopulateCoordinator;
      // The MediaCache object store the `_screenshot/` route streams from.
      // Optional — a process without one configured serves every screenshot
      // request as an uncaptured miss.
      mediaCacheAdapter?: MediaCacheAdapter;
      // Coalescing + TTL cache for assembled card+json GET bodies, shared
      // across every realm in the process. Optional — without one, each card
      // GET assembles its own body.
      cardDocumentCache?: CardDocumentCache;
    },
    opts?: Options,
  ) {
    this.paths = new RealmPaths(new URL(url), virtualNetwork);
    this.#realmSecretSeed = secretSeed;
    this.#dbAdapter = dbAdapter;
    this.#adapter = adapter;
    this.#queue = queue;
    this.#virtualNetwork = virtualNetwork;
    this.#fullIndexOnStartup = opts?.fullIndexOnStartup ?? false;
    this.#skipBootIndex = opts?.skipBootIndex ?? false;
    this.#fromScratchIndexPriority =
      opts?.fromScratchIndexPriority ?? systemInitiatedPriority;
    this.#matrixClient = matrixClient;
    this.#matrixClientUserId = userIdFromUsername(
      this.#matrixClient.username,
      this.#matrixClient.matrixURL.href,
    );
    this.#realmServerURL = ensureTrailingSlash(realmServerURL);
    this.#transpileCoordinator = transpileCoordinator;
    this.#cardSizeLimitBytes =
      cardSizeLimitBytes ?? DEFAULT_CARD_SIZE_LIMIT_BYTES;
    this.#fileSizeLimitBytes =
      fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
    this.#audioSizeLimitBytes =
      audioSizeLimitBytes ?? DEFAULT_AUDIO_SIZE_LIMIT_BYTES;
    this.#videoSizeLimitBytes =
      videoSizeLimitBytes ?? DEFAULT_VIDEO_SIZE_LIMIT_BYTES;
    this.#disableModuleCaching = Boolean(opts?.disableModuleCaching);
    this.#linkShapePolicy =
      opts?.linkShapePolicy ?? LinkShapePolicy.pinned('full');
    this.#copiedFromRealm = opts?.copiedFromRealm;
    this.#mediaCacheAdapter = mediaCacheAdapter;
    this.#cardDocumentCache = cardDocumentCache;
    this.#screenshotSyncWaitMs =
      opts?.screenshotSyncWaitMs ?? SCREENSHOT_SYNC_WAIT_BUDGET_MS;
    this.#readIndexDrainBudgetMs =
      opts?.readIndexDrainBudgetMs ?? READ_INDEX_DRAIN_BUDGET_MS;
    let owner: string | undefined;
    let _fetch = fetcher(
      virtualNetwork.fetch,
      [
        // when we run cards directly in node we do so under the authority of the
        // realm server so that we can assume the user that owns this realm. this
        // logic will eventually go away after we refactor to running cards only
        // in headless chrome.
        async (req, next) => {
          if (!owner) {
            owner = await this.getRealmOwnerUserId();
          }
          req.headers.set('X-Boxel-Assume-User', owner);
          return next(req);
        },
        async (req, next) => {
          return (await maybeHandleScopedCSSRequest(req)) || next(req);
        },
        async (request, next) => {
          if (!this.paths.inRealm(rri(request.url))) {
            return next(request);
          }
          return await this.internalHandle(request, true);
        },
        authorizationMiddleware(
          // ditto with above, we run cards under the authority of the realm
          // server so that we can assume user that owns this realm. refactor this
          // back to using the realm's own matrix client after running cards in
          // headless chrome lands.
          new RealmAuthDataSource(this.#matrixClient, () => _fetch),
        ),
      ],
      virtualNetwork,
    );

    // Wrap to retain realm context for definition lookups
    this.#definitionLookup = definitionLookup.forRealm(this);

    this.__fetchForTesting = _fetch;

    this.#realmIndexUpdater = new RealmIndexUpdater({
      realm: this,
      dbAdapter,
      queue,
    });
    this.#realmIndexQueryEngine = new RealmIndexQueryEngine({
      realm: this,
      dbAdapter,
      fetch: _fetch,
      definitionLookup: this.#definitionLookup,
    });

    this.#router = new Router(new URL(url))
      .get('/_info', SupportedMimeType.RealmInfo, this.realmInfo.bind(this))
      .query('/_info', SupportedMimeType.RealmInfo, this.realmInfo.bind(this))
      .query('/_lint', SupportedMimeType.JSON, this.lint.bind(this))
      .get('/_mtimes', SupportedMimeType.Mtimes, this.realmMtimes.bind(this))
      .get(
        '/_search',
        SupportedMimeType.CardJson,
        this.searchEntriesResponse.bind(this),
      )
      .query(
        '/_search',
        SupportedMimeType.CardJson,
        this.searchEntriesResponse.bind(this),
      )
      .get(
        '/_types',
        SupportedMimeType.CardTypeSummary,
        this.fetchCardTypeSummary.bind(this),
      )
      .get(
        '/_dependencies',
        SupportedMimeType.JSONAPI,
        this.getDependencies.bind(this),
      )
      .get(
        '/_publishability',
        SupportedMimeType.JSONAPI,
        this.publishability.bind(this),
      )
      .get(
        '/_indexing-errors',
        SupportedMimeType.JSONAPI,
        this.indexingErrors.bind(this),
      )
      .get(
        '/_card-dependencies',
        SupportedMimeType.CardDependencies,
        this.getCardDependencies.bind(this),
      )
      .post(
        '/_session',
        SupportedMimeType.Session,
        this.createSession.bind(this),
      )
      .query(
        '/_sign-capture-urls',
        SupportedMimeType.JSON,
        this.signCaptureURLs.bind(this),
      )
      .get(
        '/_permissions',
        SupportedMimeType.Permissions,
        this.getRealmPermissions.bind(this),
      )
      .patch(
        '/_permissions',
        SupportedMimeType.Permissions,
        this.patchRealmPermissions.bind(this),
      )
      .get(
        '/_readiness-check',
        SupportedMimeType.RealmInfo,
        this.readinessCheck.bind(this),
      )
      .post(
        '/_atomic',
        SupportedMimeType.JSONAPI,
        this.handleAtomicOperations.bind(this),
      )
      // The operations envelope, under the media type that carries its
      // extension and under the plain JSON:API one it extends. Both reach the
      // same handler, which reads the `ext` parameter itself: matching only the
      // extended spelling would leave a body sent as plain
      // `application/vnd.api+json` — the near miss a client makes — falling
      // through to a path nothing serves, and answering "no such route" to a
      // request that named this one.
      //
      // The method chooses the permission the realm checks, so the two verbs
      // are what separates a batch that may write from one that may not:
      // `POST` needs realm write, `QUERY` needs realm read, and a `QUERY`
      // carrying a write is refused by the handler.
      .post(
        '/_operations',
        SupportedMimeType.BoxelOperations,
        this.handleOperations.bind(this),
      )
      .query(
        '/_operations',
        SupportedMimeType.BoxelOperations,
        this.handleOperations.bind(this),
      )
      .post(
        '/_operations',
        SupportedMimeType.JSONAPI,
        this.handleOperations.bind(this),
      )
      .query(
        '/_operations',
        SupportedMimeType.JSONAPI,
        this.handleOperations.bind(this),
      )
      .post(
        '/_cancel-indexing-job',
        SupportedMimeType.JSON,
        this.cancelIndexingJob.bind(this),
      )
      .post('/_reindex', SupportedMimeType.JSON, this.queueReindex.bind(this))
      .post(
        '/_full-reindex',
        SupportedMimeType.JSON,
        this.queueFullReindex.bind(this),
      )
      .post(
        '/_invalidate',
        SupportedMimeType.JSONAPI,
        this.invalidateURLs.bind(this),
      )
      .post('(/|/.+/)', SupportedMimeType.CardJson, this.createCard.bind(this))
      .get('/.*', SupportedMimeType.CardJson, this.getCard.bind(this))
      .get('/.*', SupportedMimeType.CardHtml, this.getCardHtml.bind(this))
      .get(
        '/.*',
        SupportedMimeType.FileMetaHtml,
        this.getFileMetaHtml.bind(this),
      )
      .get('/.*', SupportedMimeType.Markdown, this.getCardMarkdown.bind(this))
      .patch(
        '/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.patchCardInstance.bind(this),
      )
      .delete(
        '/|/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.removeCard.bind(this),
      )
      .post(
        '/.*',
        SupportedMimeType.CardSource,
        this.upsertCardSource.bind(this),
      )
      .post(
        '/.*',
        SupportedMimeType.OctetStream,
        this.upsertBinaryFile.bind(this),
      )
      .get('/.*', SupportedMimeType.FileMeta, this.getFileMeta.bind(this))
      .head(
        '/.*',
        SupportedMimeType.CardSource,
        this.getSourceOrRedirect.bind(this),
      )
      .get(
        '/.*',
        SupportedMimeType.CardSource,
        this.getSourceOrRedirect.bind(this),
      )
      .delete(
        '/.+',
        SupportedMimeType.CardSource,
        this.removeCardSource.bind(this),
      )
      .get(
        '.*/',
        SupportedMimeType.DirectoryListing,
        this.getDirectoryListing.bind(this),
      );

    // Realm discovery: a `HEAD` on any path, in any `Accept` bucket without a
    // `HEAD` route of its own, answers with the realm-identity headers alone.
    // It says nothing about whether the path names anything and asks nothing
    // of the caller, which is what lets a client work out which realm serves a
    // URL — and whether that realm is public — before it has credentials for
    // it.
    Object.values(SupportedMimeType).forEach((mimeType) => {
      if (
        mimeType !== SupportedMimeType.CardSource &&
        mimeType !== SupportedMimeType.CardJson
      ) {
        this.#router.head('/.*', mimeType as SupportedMimeType, async () => {
          let requestContext = await this.createRequestContext('read');
          return this.realmIdentityResponse(requestContext);
        });
      }
    });
    // card+json is the one bucket where a `HEAD` is a read: a caller permitted
    // to read gets the headers its `GET` would carry, and everyone else the
    // discovery answer above.
    //
    // A `HEAD` is a read exactly where the `GET` is the card read, which is
    // every card+json path but this one: `_search` answers a query rather than
    // a card, so a `HEAD` of it keeps the discovery answer instead of
    // reporting that the realm has no card there. Registered first, since the
    // catch-all below would otherwise claim it.
    this.#router.head('/_search', SupportedMimeType.CardJson, async () => {
      let requestContext = await this.createRequestContext('read');
      return this.realmIdentityResponse(requestContext);
    });
    this.#router.head(
      '/.*',
      SupportedMimeType.CardJson,
      this.headCard.bind(this),
    );
  }

  async logInToMatrix() {
    await this.#matrixClient.login();
  }

  async ensureSessionRoom(matrixUserId: string): Promise<string | undefined> {
    let sessionRoom = await fetchSessionRoom(this.#dbAdapter, matrixUserId);

    if (!sessionRoom) {
      await this.#matrixClient.login();
      let userExistsInDB = await userExists(this.#dbAdapter, matrixUserId);
      if (!userExistsInDB) {
        // TODO: should we create it if it doesn't exist?
        return undefined;
      }
      sessionRoom = await this.#matrixClient.createDM(matrixUserId);
      await upsertSessionRoom(this.#dbAdapter, matrixUserId, sessionRoom);
    }

    return sessionRoom;
  }

  private async readinessCheck(
    request: Request,
    requestContext: RequestContext,
  ) {
    // Report not-ready as a 503 with a retry hint rather than a false 200: a
    // poller keeps waiting, and a single-shot caller sees the failure instead
    // of treating the work it is waiting on as complete. `X-Boxel-Not-Ready`
    // names which stage is outstanding — each has a different cause and a
    // different remedy, and the poll loops that consume this discard the
    // body, so the header is the only place an operator can read it from.
    let notReady = (
      stage: 'startup' | 'index' | 'index-failed' | 'prerender-html',
      detail?: string,
    ) =>
      createResponse({
        body: detail ?? null,
        init: {
          headers: {
            'content-type': detail ? 'text/plain' : 'text/html',
            // `index-failed` is terminal — the realm cannot become ready
            // without a reindex or a restart — so it carries no retry hint.
            ...(stage === 'index-failed' ? {} : { 'Retry-After': '1' }),
            'X-Boxel-Not-Ready': stage,
          },
          status: 503,
        },
        requestContext,
      });

    // #startedUp is a one-time gate that resolves after the first start()'s
    // from-scratch index. On a republish the realm is already mounted with a
    // resolved #startedUp, so awaiting it alone would report ready before the
    // reindex of the swapped files completes. Also await any in-flight full or
    // incremental index so a publish poll only succeeds once the just-published
    // content is indexed.
    //
    // Both waits are budgeted for the same reason the shared-state gates below
    // are: this endpoint's contract is that a not-yet answers, not that the
    // connection is held until the answer is yes. An unbounded wait here is
    // worse than no answer, because the canonical caller
    // (`realm-operations.waitForReady`) polls serially with no per-request
    // deadline and only re-checks its own overall budget between requests — so
    // one held-open request parks the whole poll loop for as long as the gate
    // stalls, and the client sees a hung connection rather than a status it can
    // read. Returning 503 keeps the loop ticking against its own deadline, and
    // a gate that clears later is picked up by the next poll.
    //
    // One deadline spans every gate below, so a request costs one hold no
    // matter how many gates it clears. Each log line reports the time that gate
    // actually spent, not the budget: when startup consumes most of it the
    // later gates expire almost immediately, and a message naming the full
    // budget would send an operator looking for a slow index that never
    // happened.
    let waitStartedAt = Date.now();
    let requestDeadline = waitStartedAt + READINESS_REQUEST_BUDGET_MS;
    if (!(await settledBy(this.#startedUp.promise, requestDeadline))) {
      this.#log.warn(
        `readiness check for ${this.url} is still waiting on realm startup after ${Date.now() - waitStartedAt}ms`,
      );
      return notReady('startup');
    }
    let startupSettledAt = Date.now();
    let inflight = this.indexing();
    if (inflight && !(await settledBy(inflight, requestDeadline))) {
      this.#log.warn(
        `readiness check for ${this.url} is still waiting on in-flight indexing after ${Date.now() - startupSettledAt}ms ` +
          `(realm startup used ${startupSettledAt - waitStartedAt}ms of the ${READINESS_REQUEST_BUDGET_MS}ms budget)`,
      );
      return notReady('index');
    }

    // Both gates above read per-process state: they see only the indexing this
    // instance itself started. Behind a load balancer fronting several
    // realm-server replicas, a poll can land on a replica that did not handle
    // the publish or create — it finds the realm mounted with nothing in
    // flight and answers ready while the other replica's index is still
    // running. A republish is the sharp case: the realm already has index
    // rows, so #startup skips its from-scratch pass and #startedUp resolves
    // without reflecting the swapped files. Every replica reads the same job
    // rows, so the realm's index lane holding no outstanding work is the same
    // answer everywhere. A realm with no server-side queue has no such lane and
    // reports settled without a query.
    // This gate shares the in-process gates' deadline rather than starting a
    // fresh budget, so one request costs one hold no matter how many gates it
    // clears. That keeps the endpoint inside the per-attempt deadline the
    // budget is sized against — the CI readiness probes cap each attempt at
    // `curl --max-time 15`, and a request that spent its budget on startup and
    // then started another full budget here would blow past that and hand the
    // probe a connection timeout instead of a status it can read.
    //
    // Narrowed to the jobs that write the index. The lane also carries work
    // that only has to stay off a running pass — `scoped-css-gc` — and such a
    // job says nothing about whether the index is behind its source. Gating on
    // the bare lane makes any backlog in front of that job read as an
    // unfinished index, and the daily GC cron enqueues one job per realm: on a
    // slow background queue that is every realm at once, for as long as the
    // sweep takes to drain.
    let laneWaitStartedAt = Date.now();
    if (
      !(await awaitRealmIndexSettled(this.#dbAdapter, this.url, {
        timeoutMs: Math.max(0, requestDeadline - Date.now()),
        jobTypes: INDEX_WRITING_JOB_TYPES,
      }))
    ) {
      // The lane never drained within budget — a job queued behind a long
      // backlog, or one whose worker died and has yet to be reaped. Keep the
      // caller polling instead of reporting a realm ready whose index is
      // knowably behind its source.
      //
      // Name the jobs. This is the one gate here that can hold a realm for
      // hours on state no part of this process owns, and without the ids an
      // operator cannot tell it from the two in-process gates above — they
      // differ only in which log line is absent.
      //
      // Strictly best-effort, and bounded: the read happens after the budget is
      // spent, so it must not be able to turn this 503 into a 500 or extend the
      // request. Every outcome is reported distinctly, including the two ways
      // the read itself can fail, because a lane that drained just after the
      // gate expired, a database that refused, and one that never answered each
      // send whoever reads this somewhere different.
      let read = await readLaneHoldersBestEffort(
        this.#dbAdapter,
        this.url,
        INDEX_WRITING_JOB_TYPES,
        LANE_DIAGNOSTIC_BUDGET_MS,
      );
      let heldBy: string;
      switch (read.outcome) {
        case 'read':
          heldBy = read.holders.length
            ? read.holders
                .map(
                  ({ id, jobType, claimed }) =>
                    `job ${id} (${jobType}, ${claimed ? 'claimed' : 'waiting'})`,
                )
                .join(', ')
            : 'the lane drained after the gate expired';
          break;
        case 'failed':
          heldBy = `could not read the lane: ${read.reason}`;
          break;
        case 'timed-out':
          heldBy = `could not read the lane within ${LANE_DIAGNOSTIC_BUDGET_MS}ms`;
          break;
      }
      this.#log.warn(
        `readiness check for ${this.url} is still waiting on queued index work after ${Date.now() - laneWaitStartedAt}ms: ` +
          heldBy,
      );
      return notReady('index');
    }

    // The lane is clear, so every from-scratch job for this realm has run. A
    // realm that has never had an index built, whose newest such job was
    // rejected, is mounted over nothing: reporting ready would hand the caller
    // a realm that serves nothing, and `index` would keep it polling for work
    // that is not coming. Both facts are read from shared state (see
    // unbuiltIndexFailure), so every replica answers alike, and a pass that
    // completes from any path — this realm's own endpoints, a publish, the
    // system-wide reindex — clears it as soon as it lands. The body carries
    // the failure, since that is where the cause is.
    let unbuilt = await unbuiltIndexFailure(this.#dbAdapter, this.url);
    if (unbuilt) {
      return notReady(
        'index-failed',
        `The boot index of ${this.url} failed: ${unbuilt}`,
      );
    }

    // Opt-in: also await the published HTML being live for the current
    // generation. Indexing makes a realm searchable; prerendering makes it
    // viewable — and for a published realm the HTML is the deliverable. That
    // work lands on a separate (fire-and-forget) channel, so the publish flow
    // sets `awaitPrerenderHtml` to hold readiness until the rendered HTML
    // exists, not just the index. Left off by default so createRealm / boot
    // readiness stay index-only and fast.
    if (
      new URL(request.url).searchParams.get('awaitPrerenderHtml') === 'true'
    ) {
      let htmlReady = await awaitPublishedHtmlReady(this.#dbAdapter, this.url);
      if (!htmlReady) {
        // The current generation's HTML never became live within budget (a
        // stuck/failed render, or a queue backlog longer than the wait).
        return notReady('prerender-html');
      }
    }

    return createResponse({
      body: null,
      init: {
        headers: { 'content-type': 'text/html' },
        status: 200,
      },
      requestContext,
    });
  }

  async indexing() {
    return this.#realmIndexUpdater.indexing();
  }

  // Returns undefined when there is no in-flight incremental indexing, or a
  // Promise that resolves once every currently in-flight job settles. Not
  // declared `async` on purpose — the `async` wrapper would force a Promise
  // return even in the no-pending case, defeating callers (and tests) that
  // synchronously check whether indexing is pending.
  incrementalIndexing(): Promise<void> | undefined {
    return this.#realmIndexUpdater.incrementalIndexing();
  }

  private startReindex(opts?: {
    clearLastModified?: boolean;
    priority?: number;
  }): { published: Promise<Job<FromScratchResult>>; completed: Promise<void> } {
    let { published, completed: indexingCompleted } =
      this.#realmIndexUpdater.publishFullIndex(
        opts?.priority ?? systemInitiatedPriority,
        {
          clearLastModified: opts?.clearLastModified,
        },
      );

    // CS-11182: previously the chain was
    //   await clearRealmDefinitions;
    //   #dropAllTranspiledModuleCacheEntries();
    //   broadcastIncrementalInvalidationEvent(...);
    //   broadcastRealmEvent(...);
    // — so a throw or hang in clearRealmDefinitions left the transpile-
    // cache rows live and the broadcasts unsent, and clients kept being
    // served pre-reindex bytes. Reorder so the synchronous, no-upstream-
    // dependency work (L1 wipe, fire-and-forget L2 tombstone, broadcasts)
    // happens first, and the awaited clearRealmDefinitions runs last
    // where its rejection or stall can no longer block the rest. The
    // broadcast helpers are fire-and-forget by design (the adapter call
    // inside `broadcastRealmEvent` is invoked without `await`) so we
    // call them without a try/catch, matching every other call site.
    let completed = indexingCompleted.then(
      async ({ invalidations, generation }) => {
        try {
          this.#dropAllTranspiledModuleCacheEntries();
        } catch (err: unknown) {
          this.#log.error(
            `dropAllTranspiledModuleCacheEntries failed after reindex of ${this.url}: ${String(err)}`,
          );
        }
        if (invalidations.length > 0) {
          this.broadcastIncrementalInvalidationEvent(invalidations, {
            generation,
          });
        }
        this.broadcastRealmEvent({
          eventName: 'index',
          indexType: 'full',
          ...(generation !== undefined ? { generation } : {}),
          realmURL: this.url,
        });
        try {
          await this.#definitionLookup.clearRealmDefinitions(this.url);
        } catch (err: unknown) {
          this.#log.error(
            `clearRealmDefinitions failed after reindex of ${this.url}: ${String(err)}`,
          );
        }
      },
    );

    void completed.catch((error: unknown) => {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        try {
          message = JSON.stringify(error);
        } catch (_err) {
          message = String(error);
        }
      }
      this.#log.error(`Error completing reindex for ${this.url}: ${message}`);
    });

    return {
      published,
      completed,
    };
  }

  private async cancelIndexingJob(
    request: Request,
    requestContext: RequestContext,
  ) {
    let cancelPending = false;
    try {
      let body = await request.text();
      if (body) {
        let parsed = JSON.parse(body) as { cancelPending?: boolean };
        cancelPending = parsed.cancelPending === true;
      }
    } catch {
      // No body or invalid JSON — use default (running only).
    }

    if (cancelPending) {
      await cancelAllJobsInConcurrencyGroup(
        this.#dbAdapter,
        indexingConcurrencyGroup(this.url),
      );
    } else {
      await cancelRunningJobsInConcurrencyGroup(
        this.#dbAdapter,
        indexingConcurrencyGroup(this.url),
      );
    }

    return createResponse({
      body: null,
      init: {
        status: 204,
      },
      requestContext,
    });
  }

  private async queueReindex(
    _request: Request,
    requestContext: RequestContext,
  ) {
    let { published } = this.startReindex({
      priority: userInitiatedPriority,
    });
    await published;

    return createResponse({
      body: null,
      init: {
        status: 204,
      },
      requestContext,
    });
  }

  private async queueFullReindex(
    _request: Request,
    requestContext: RequestContext,
  ) {
    let { published } = this.startReindex({
      clearLastModified: true,
      priority: userInitiatedPriority,
    });
    await published;

    return createResponse({
      body: null,
      init: {
        status: 204,
      },
      requestContext,
    });
  }

  private async updateIndexAndCollectInvalidations(
    changes: IndexChange[],
    opts?: {
      clientRequestId?: string | null;
      initiatedBy?: string | null;
      // Ask the pass not to enqueue its own prerender_html job; the returned
      // `deferredPrerenderHtml` then carries the set it would have rendered.
      deferPrerenderHtml?: boolean;
      // Invalidation sets earlier passes of this same write deferred, folded
      // into the prerender_html job this pass spawns.
      carriedPrerenderHtmlChanges?: IncrementalChange[];
      // Where a caller reporting where its write's time went wants this pass's
      // two halves stamped: queueing the job, and waiting for a worker to run
      // it. They answer different questions — a queue that is slow to accept
      // work, against a worker pool that is slow to reach it — and the second
      // is the one a card write spends its seconds in.
      stageCursor?: StageCursor;
    },
  ): Promise<
    IndexPassResult & { deferredPrerenderHtml?: DeferredPrerenderHtml }
  > {
    if (changes.length === 0) {
      // No pass ran, so nothing was touched — which the empty set states
      // exactly, and more usefully than staying silent would.
      return { invalidations: [], invalidatedTypes: [] };
    }

    let invalidations = new Set<string>();
    let invalidatedTypes = makeInvalidatedTypeAccumulator();
    let generation: number | undefined;
    let deferredPrerenderHtml: DeferredPrerenderHtml | undefined;
    let stageCursor = opts?.stageCursor;
    await this.#realmIndexUpdater.updateChanges(changes, {
      clientRequestId: opts?.clientRequestId ?? null,
      initiatedBy: opts?.initiatedBy ?? null,
      ...(opts?.deferPrerenderHtml ? { deferPrerenderHtml: true } : {}),
      ...(opts?.carriedPrerenderHtmlChanges?.length
        ? { carriedPrerenderHtmlChanges: opts.carriedPrerenderHtmlChanges }
        : {}),
      onEnqueued: () => stageCursor?.mark('enqueue'),
      onDeferredPrerenderHtml: (deferred) => {
        deferredPrerenderHtml = deferred;
      },
      onInvalidation: async (invalidatedURLs: URL[], meta) => {
        // Reached the moment the worker's job resolves, so the window that
        // closes here is the wait for it — queue time plus the pass itself.
        // A pass that fails never reaches this, so its wait stays in the
        // residual rather than being reported as a wait that completed. The
        // line's `status` is what tells those apart.
        stageCursor?.mark('awaitIndex');
        // Drop the searchCards in-flight map: the worker's batch.done()
        // swap landed in this realm's boxel_index, so any pending
        // pre-update promises must not be coalesced into by post-update
        // callers. CS-11119 also broadcasts the same wipe to peer
        // replicas via NOTIFY realm_index_updated so their #inFlightSearch
        // maps don't coalesce post-update callers into pre-update promises.
        await this.clearRealmIndexCachesAndBroadcast();
        await this.touchSourceRealmUpdatedAt();
        await this.handleExecutableInvalidations(invalidatedURLs);
        for (let invalidatedURL of invalidatedURLs) {
          invalidations.add(invalidatedURL.href);
        }
        invalidatedTypes.add(meta);
        generation = meta.generation ?? generation;
      },
    });

    return {
      invalidations: [...invalidations],
      generation,
      invalidatedTypes: invalidatedTypes.value,
      ...(deferredPrerenderHtml ? { deferredPrerenderHtml } : {}),
    };
  }

  // Two-phase variant for the deferred-indexing path. Awaits the durable
  // queue insert so pre-enqueue failures (DB partial outage) propagate to
  // the caller; the returned `settled` promise resolves once the worker
  // finishes, onInvalidation runs, and the caller's onSettled hook runs.
  // Worker-time and post-worker failures reject `settled` and surface via
  // error_doc inside the worker as before.
  //
  // The caller's onSettled hook receives the collected invalidations and
  // runs *inside the indexing deferred lifecycle* — before the deferred is
  // fulfilled and removed from #incrementalIndexingDeferreds. Routing the
  // post-worker invalidation broadcast through this hook (instead of an
  // outer .then() on settled) means realm.incrementalIndexing() genuinely
  // waits for the broadcast, which is the only way an afterEach drain can
  // prevent the broadcast from racing with mock-matrix teardown.
  private async enqueueIndexUpdateAndCollectInvalidations(
    changes: IndexChange[],
    opts: {
      clientRequestId?: string | null;
      initiatedBy?: string | null;
      // Invalidation sets earlier passes of this same write deferred, folded
      // into the prerender_html job this pass spawns.
      carriedPrerenderHtmlChanges?: IncrementalChange[];
      onSettled?: (
        invalidations: string[],
        meta: IncrementalIndexMeta,
      ) => Promise<void> | void;
    },
  ): Promise<{ settled: Promise<void> }> {
    if (changes.length === 0) {
      if (opts.onSettled) {
        await opts.onSettled([], { invalidatedTypes: [] });
      }
      return { settled: Promise.resolve() };
    }

    let invalidations = new Set<string>();
    let invalidatedTypes = makeInvalidatedTypeAccumulator();
    let generation: number | undefined;
    let { settled } = await this.#realmIndexUpdater.enqueueChanges(changes, {
      clientRequestId: opts?.clientRequestId ?? null,
      initiatedBy: opts?.initiatedBy ?? null,
      ...(opts?.carriedPrerenderHtmlChanges?.length
        ? { carriedPrerenderHtmlChanges: opts.carriedPrerenderHtmlChanges }
        : {}),
      onInvalidation: async (invalidatedURLs: URL[], meta) => {
        await this.clearRealmIndexCachesAndBroadcast();
        await this.touchSourceRealmUpdatedAt();
        await this.handleExecutableInvalidations(invalidatedURLs);
        for (let invalidatedURL of invalidatedURLs) {
          invalidations.add(invalidatedURL.href);
        }
        invalidatedTypes.add(meta);
        generation = meta.generation ?? generation;
      },
      onSettled: async () => {
        if (opts.onSettled) {
          await opts.onSettled([...invalidations], {
            generation,
            invalidatedTypes: invalidatedTypes.value,
          });
        }
      },
      onFailed: async () => {
        // A failed job may still have swapped setup-phase error docs into
        // boxel_index for the URLs it was handed. Run the same cache wipe the
        // success path does and broadcast those URLs, so local and peer
        // readers — and live subscribers — see the error state now rather
        // than after the next successful swap. Broadcasting is safe when
        // nothing landed: subscribers re-fetch and find the rows unchanged.
        await this.clearRealmIndexCachesAndBroadcast();
        this.broadcastIncrementalInvalidationEvent(
          changes.map(({ url }) => url.href.replace(/\.json$/, '')),
          { clientRequestId: opts?.clientRequestId ?? null },
        );
      },
    });

    return { settled };
  }

  private broadcastIncrementalInvalidationEvent(
    invalidations: string[],
    opts?: {
      clientRequestId?: string | null;
      generation?: number;
      invalidatedTypes?: string[];
    },
  ): void {
    this.broadcastRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      invalidations,
      ...(opts && Object.prototype.hasOwnProperty.call(opts, 'clientRequestId')
        ? { clientRequestId: opts.clientRequestId }
        : {}),
      ...(opts?.generation !== undefined
        ? { generation: opts.generation }
        : {}),
      ...boundedInvalidatedTypes(opts?.invalidatedTypes),
      realmURL: this.url,
    });
  }

  private async invalidateURLs(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let json: { data?: { attributes?: { urls?: unknown } } };
    try {
      json = await request.json();
    } catch (e: any) {
      return badRequest({
        message: `The request body was not json: ${e.message}`,
        requestContext,
      });
    }

    let rawURLs = json.data?.attributes?.urls;
    if (rawURLs === undefined) {
      return badRequest({
        message: `The request body was missing urls`,
        requestContext,
      });
    }
    if (!Array.isArray(rawURLs)) {
      return badRequest({
        message: `urls must be an array of URL strings`,
        requestContext,
      });
    }

    let seen = new Set<string>();
    let urls: URL[] = [];
    for (let rawURL of rawURLs) {
      if (typeof rawURL !== 'string') {
        return badRequest({
          message: `urls must be an array of URL strings`,
          requestContext,
        });
      }
      let parsedURL: URL;
      try {
        parsedURL = new URL(rawURL);
      } catch (e: any) {
        return badRequest({
          message: `urls contains an invalid URL: ${rawURL} (${e.message})`,
          requestContext,
        });
      }
      if (!this.paths.inRealm(parsedURL)) {
        return badRequest({
          message: `URL is not in realm: ${parsedURL.href}`,
          requestContext,
        });
      }
      if (!seen.has(parsedURL.href)) {
        seen.add(parsedURL.href);
        urls.push(parsedURL);
      }
    }

    let { invalidations, generation, invalidatedTypes } =
      await this.updateIndexAndCollectInvalidations(
        urls.map((url) => ({ url, operation: 'update' as const })),
        { initiatedBy: requestContext.authenticatedUser ?? null },
      );
    this.broadcastIncrementalInvalidationEvent(invalidations, {
      generation,
      invalidatedTypes,
    });

    return createResponse({
      body: null,
      init: {
        status: 204,
      },
      requestContext,
    });
  }

  // `fromScratchIndexPriority` overrides the realm's default priority
  // for the from-scratch-index job that `#startup` enqueues when the
  // realm has no prior index. Callers that mount-on-demand for a
  // user-initiated flow (e.g. realm creation) pass
  // `userInitiatedPriority` so the resulting job jumps ahead of any
  // backlog of system-priority indexing work.
  async start(opts?: { fromScratchIndexPriority?: number }) {
    this.#startedUp.fulfill((() => this.#startup(opts))());

    if (this.#adapter.fileWatcherEnabled) {
      await this.startFileWatcher();
    }

    await this.#startedUp.promise;
  }

  async fullIndex(
    priority?: number,
    opts?: { clearLastModified?: boolean; awaitedByPublish?: boolean },
  ) {
    // Clear the realmInfo cache before re-indexing so cards rendered
    // during this pass read /realm.json from the now-populated index
    // rather than a stale "Unnamed Workspace" cached during an earlier
    // from-scratch pass that processed /index before /realm.json.
    // CardsGrid.cardTitle → realmInfo.name drives og:title, which is
    // baked into the prerendered HTML — clearing only after the pass
    // would be too late.
    this.invalidateCachedRealmInfo();
    let { completed } = this.#realmIndexUpdater.publishFullIndex(
      priority ?? systemInitiatedPriority,
      {
        clearLastModified: opts?.clearLastModified,
        awaitedByPublish: opts?.awaitedByPublish,
      },
    );
    await completed;
    // The from-scratch swap has landed in boxel_index: drop searchCards
    // in-flight entries + the cached RealmInfo (which may have been
    // re-parsed from /realm.json during the pass), and broadcast the
    // same wipe to peer replicas via NOTIFY realm_index_updated so
    // their caches don't continue serving pre-update state (CS-11119).
    await this.clearRealmIndexCachesAndBroadcast();
  }

  async flushUpdateEvents() {
    return this.#flushUpdateEvents;
  }

  __testOnlyClearCaches() {
    this.#dropAllSourceCacheEntries();
    this.#dropAllTranspiledModuleCacheEntries();
    // Reset the transpile counter so each test reasons about its own
    // delta. Production never reads this counter — only the CS-11029
    // dedup tests do (CS-11029).
    this.#transpileCallCount = 0;
    this.#transpileJoinCount = 0;
  }

  // CS-11043. Bulk-invalidate this realm's in-process byte caches.
  // Called by the publish-realm handler after the FS swap, BEFORE the
  // reindex enqueues — so that subsequent source reads (which the
  // reindex's prerender fans out across many of) bypass any
  // pre-swap bytes the realm still has in `#sourceCache` /
  // `#transpiledModuleCache`. The Phase-3-PR-2 publish flow relies on the
  // NodeAdapter file-watcher to pick up the swap, but that's an
  // async-event race against the immediately-enqueued reindex; this
  // method makes the invalidation synchronous from the publish
  // handler's vantage point. Different from `__testOnlyClearCaches`
  // in that it does NOT reset the transpile counter (which is
  // test-only diagnostic state, unrelated to byte-correctness).
  // CS-11156: this is the local bulk-invalidate primitive that both the
  // publish-realm handler and the cross-replica `realm_file_changes:*`
  // listener invoke. The publish handler reaches it via
  // `clearLocalSourceCachesAndBroadcast` (local clear + peer broadcast);
  // the listener invokes it directly (no broadcast — would NOTIFY-loop).
  clearLocalSourceCaches(): void {
    this.#dropAllSourceCacheEntries();
    this.#dropAllTranspiledModuleCacheEntries();
  }

  // CS-11029 test seams: tests need to assert "N concurrent same-path
  // readers triggered exactly one transpile" and "the in-flight slot
  // released after the shared transpile settled." Exposing the
  // monotonic counter + the live map size is the smallest surface that
  // satisfies both — no externally-observable behavior changes.
  __testOnlyGetTranspileCallCount(): number {
    return this.#transpileCallCount;
  }
  __testOnlyGetInFlightTranspileCount(): number {
    return this.#inFlightTranspiles.size;
  }
  // Counts every time a concurrent caller of #transpileModuleDeduped
  // joined an existing in-flight entry instead of starting a new one.
  // The dedup tests poll this to know "B has joined A's pending" so
  // they can release the gate at a deterministic point — without it,
  // tests using a real .gts that throws fast at babel can't reliably
  // observe the in-flight overlap window before A settles.
  __testOnlyGetTranspileJoinCount(): number {
    return this.#transpileJoinCount;
  }
  // Test-only gate: when set, #materializeAndTranspile awaits the
  // returned promise before calling transpileJS. Lets the dedup tests
  // park a transpile mid-flight so they can observe inflight state
  // without racing real .gts transpile timing in CI. The hook fires
  // BEFORE #transpileCallCount is bumped — when the count rises, the
  // gate has released and babel is running.
  __testOnlyDelayTranspile(fn: (() => Promise<void>) | undefined): void {
    this.#testOnlyTranspileDelay = fn;
  }
  #testOnlyTranspileDelay?: () => Promise<void>;

  // Test-only gate for the source-cache set-after-invalidate race: when set,
  // getSourceOrRedirect awaits the returned promise AFTER it has read the file
  // bytes from disk but BEFORE it writes #sourceCache. Lets the race test park
  // a source read mid-flight, fire invalidateCache concurrently, then release
  // — deterministically reproducing the window the generation guard closes,
  // without depending on real worker/indexer timing.
  __testOnlyDelaySourceCacheSet(fn: (() => Promise<void>) | undefined): void {
    this.#testOnlySourceCacheDelay = fn;
  }
  #testOnlySourceCacheDelay?: () => Promise<void>;

  // Drop every read-side cache whose content derives from server-side
  // state — currently `#cachedRealmInfo` (cached `RealmInfo` + ETag-hash;
  // mostly index-derived, but its `visibility` field is permissions-derived)
  // and the cached host routing map. Called by the realm_index_updated LISTEN
  // handler on peer instances after a swap commits — or after a
  // `realm_permissions` PATCH lands — somewhere else in the fleet. Public so
  // the realm-server process can wire the listener without reaching into
  // private state.
  clearRealmIndexCaches(): void {
    this.invalidateCachedRealmInfo();
    this.#cachedHostRoutingMap = null;
  }

  // Drop local realm-index caches AND broadcast the same wipe to peer
  // replicas via realm_index_updated. Called at every site where this
  // replica's boxel_index has just swapped — closes the post-update
  // staleness window both locally and on peers. Best-effort broadcast;
  // a missed NOTIFY is a bounded staleness window (one in-flight
  // searchCards walk + a slightly stale ETag), not data corruption.
  // Mirrors CS-11156's clearLocalSourceCachesAndBroadcast pattern for
  // the byte-cache surface.
  async clearRealmIndexCachesAndBroadcast(): Promise<void> {
    this.clearRealmIndexCaches();
    await notifyRealmIndexUpdated(this.#dbAdapter, this.url);
  }

  // Invalidate the in-memory byte caches for a single path. Called by the
  // realm_file_changes LISTEN handler on peer instances after a write lands
  // somewhere else in the fleet. The shape matches the file-watcher receiver
  // below — invalidate source always, invalidate module only for executable
  // extensions. Public so the realm-server process can wire a NOTIFY listener
  // without reaching into private state.
  invalidateCache(path: LocalPath): void {
    this.#dropSourceCacheEntry(path);
    if (hasExecutableExtension(path)) {
      this.#dropTranspiledModuleEntry(path);
    }
  }

  // Refresh this instance's filesystem view of the directories that hold
  // `path`, after a peer instance wrote or deleted that path. See
  // DirectoryViewRefresher for why a shared-filesystem peer needs this and how
  // repeated requests for one directory are coalesced.
  refreshDirectoryView(path: LocalPath): Promise<void> {
    return this.#directoryViewRefresher.refresh(path);
  }

  // CS-11028: shared drop helper for any in-process site that invalidates a
  // single #transpiledModuleCache entry — writeMany, delete/deleteAll, the local
  // file-watcher callback, the index-updater's executable-invalidation
  // cascade, the public invalidateCache entry point, etc. Bumps the
  // per-path generation BEFORE the cache delete so a concurrent in-flight
  // transpile for the same path — already past its generation snapshot in
  // fallbackHandle — observes the new value at persist time and drops its
  // #transpiledModuleCache.set instead of re-filling the slot we're about to empty.
  #dropTranspiledModuleEntry(path: LocalPath): void {
    this.#bumpTranspiledModuleCacheGeneration(path);
    this.#transpiledModuleCache.invalidate(path);
    // CS-11029: drop the in-flight transpile entry too. Existing
    // waiters on the old promise still receive its result — their
    // requests preceded the invalidate, so pre-invalidation bytes are
    // the correct response. But a caller arriving AFTER this point
    // must not join the stale transpile (its #transpiledModuleCache.set is
    // about to be discarded by the generation guard); they install
    // their own pending against current source instead.
    this.#inFlightTranspiles.delete(path);
    // CS-11030: also DELETE the cross-process L2 row. Fire-and-forget
    // because invalidateCache is sync (called from the LISTEN handler
    // among others). Best-effort by design — every peer's listener
    // runs the same DELETE for its own copy, so a transient pg
    // failure on one peer is repaired by the next; and a stale L2
    // row that survives is corrected on next reader's invalidate
    // path or by the writer overwriting it via the ON CONFLICT DO
    // NOTHING (which becomes a no-op once we re-DELETE).
    let canonicalPath = this.paths.fileURL(path).href;
    void this.#deleteTranspileCacheRow(canonicalPath);
  }

  // Wipes every #transpiledModuleCache entry and bumps the global generation so any
  // in-flight transpile whose snapshot was taken before this wipe discards
  // its post-transpile cache write rather than re-populating the
  // just-cleared map (CS-11028). The per-path map is cleared because the
  // generations it held are no longer reachable — the global counter is
  // what catches in-flight snapshots after a wipe.
  #dropAllTranspiledModuleCacheEntries(): void {
    this.#transpiledModuleCache.clear();
    this.#transpiledModuleCacheGenerations.clear();
    this.#transpiledModuleCacheGlobalGeneration += 1;
    // CS-11029: same reason as #dropTranspiledModuleEntry — post-wipe
    // callers must not join a stale transpile.
    this.#inFlightTranspiles.clear();
    // CS-11030: fire-and-forget bulk DELETE for the realm's L2 rows.
    void this.#deleteAllTranspileCacheRows();
  }

  #bumpTranspiledModuleCacheGeneration(path: LocalPath): void {
    this.#transpiledModuleCacheGenerations.set(
      path,
      (this.#transpiledModuleCacheGenerations.get(path) ?? 0) + 1,
    );
  }

  // Snapshot generations for every path the in-flight request could end
  // up resolving to. fallbackHandle hands us the request's localPath
  // (e.g. "foo"), but loadModuleFromDisk's getFileWithFallbacks may
  // resolve to "foo" or to "foo.<ext>" for each executable extension —
  // and invalidateCache fires against the canonical (with-extension)
  // path. Snapshotting only "foo" would let an invalidate of "foo.gts"
  // bump the canonical's generation while leaving the snapshotted
  // "foo" gen unchanged, so the post-await check would miss the race
  // and re-populate the "foo" alias with pre-invalidation bytes. By
  // snapshotting all candidates here and letting the post-await check
  // key on result.canonicalPath, we catch the race whether the request
  // was extensionless or not.
  #snapshotModuleCacheGeneration(localPath: LocalPath): {
    pathGens: Map<LocalPath, number>;
    global: number;
  } {
    let pathGens = new Map<LocalPath, number>();
    pathGens.set(
      localPath,
      this.#transpiledModuleCacheGenerations.get(localPath) ?? 0,
    );
    if (!hasExecutableExtension(localPath)) {
      for (let ext of executableExtensions) {
        let candidate = localPath + ext;
        pathGens.set(
          candidate,
          this.#transpiledModuleCacheGenerations.get(candidate) ?? 0,
        );
      }
    }
    return { pathGens, global: this.#transpiledModuleCacheGlobalGeneration };
  }

  #transpiledModuleCacheGenerationChanged(
    canonicalPath: LocalPath,
    snapshot: { pathGens: Map<LocalPath, number>; global: number },
  ): boolean {
    if (this.#transpiledModuleCacheGlobalGeneration !== snapshot.global) {
      return true;
    }
    let snapGen = snapshot.pathGens.get(canonicalPath) ?? 0;
    let curGen = this.#transpiledModuleCacheGenerations.get(canonicalPath) ?? 0;
    return curGen !== snapGen;
  }

  // Source-cache analogue of #dropTranspiledModuleEntry: bump the path's
  // generation BEFORE clearing the slot so a concurrent in-flight source read
  // — already past its generation snapshot in getSourceOrRedirect — observes
  // the new value at persist time and drops its #sourceCache.set instead of
  // re-filling the slot we're about to empty.
  #dropSourceCacheEntry(canonicalPath: LocalPath): void {
    this.#sourceCacheGenerations.set(
      canonicalPath,
      (this.#sourceCacheGenerations.get(canonicalPath) ?? 0) + 1,
    );
    this.#sourceCache.invalidate(canonicalPath);
  }

  // Source-cache analogue of #dropAllTranspiledModuleCacheEntries: wipe every
  // entry and bump the global generation so an in-flight read whose snapshot
  // predates the wipe discards its post-read set rather than re-populating the
  // just-cleared map. The per-path map is cleared because the generations it
  // held are no longer reachable — the global counter is what catches
  // in-flight snapshots after a wipe.
  #dropAllSourceCacheEntries(): void {
    this.#sourceCache.clear();
    this.#sourceCacheGenerations.clear();
    this.#sourceCacheGlobalGeneration += 1;
  }

  // Snapshot generations for every path getSourceOrRedirect's
  // getFileWithFallbacks could resolve to: the request's localPath plus each
  // executable extension and ".json" when the request is extensionless (the
  // exact fallback set getSourceOrRedirect passes). The post-read check keys
  // on the resolved canonicalPath, so snapshotting all candidates catches the
  // race whether the request was extensionless or carried its extension —
  // same reasoning as #snapshotModuleCacheGeneration.
  #snapshotSourceCacheGeneration(localPath: LocalPath): {
    pathGens: Map<LocalPath, number>;
    global: number;
  } {
    let pathGens = new Map<LocalPath, number>();
    pathGens.set(localPath, this.#sourceCacheGenerations.get(localPath) ?? 0);
    if (!hasExecutableExtension(localPath)) {
      for (let ext of [...executableExtensions, '.json']) {
        let candidate = localPath + ext;
        pathGens.set(
          candidate,
          this.#sourceCacheGenerations.get(candidate) ?? 0,
        );
      }
    }
    return { pathGens, global: this.#sourceCacheGlobalGeneration };
  }

  #sourceCacheGenerationChanged(
    canonicalPath: LocalPath,
    snapshot: { pathGens: Map<LocalPath, number>; global: number },
  ): boolean {
    if (this.#sourceCacheGlobalGeneration !== snapshot.global) {
      return true;
    }
    let snapGen = snapshot.pathGens.get(canonicalPath) ?? 0;
    let curGen = this.#sourceCacheGenerations.get(canonicalPath) ?? 0;
    return curGen !== snapGen;
  }

  // Broadcast a file-change notification to peer realm-server instances so
  // they can invalidate their own #sourceCache / #transpiledModuleCache entries for the
  // same path. Best-effort — failures are logged and swallowed because the
  // local write already succeeded and a missed NOTIFY is a bounded cache-
  // staleness window (see docs §9 "Cache-invalidation NOTIFY missed"), not
  // a correctness failure. Adapters without pub/sub (e.g. SQLite in the
  // host/browser context) implement notify as a no-op.
  async #notifyFileChange(path: LocalPath): Promise<void> {
    try {
      await this.#dbAdapter.notify(
        REALM_FILE_CHANGES_CHANNEL,
        `${this.url}:${path}`,
      );
    } catch (err: unknown) {
      this.#log.warn(
        `notify ${REALM_FILE_CHANGES_CHANNEL} failed for ${this.url}:${path}: ${String(err)}`,
      );
    }
  }

  // Drop this replica's own `#sourceCache` / `#transpiledModuleCache` AND broadcast
  // the same wipe to peer replicas. Used by the publish-realm handler
  // before the reindex enqueue: this replica's own prerender fan-out must
  // bypass its cache (sync local clear), and peer replicas must drop
  // their pre-swap bytes too (cross-instance NOTIFY). Self-receive of the
  // NOTIFY is a no-op since `clearLocalSourceCaches()` is idempotent.
  //
  // Bundles local + broadcast in one call, mirroring
  // `CachingDefinitionLookup.clearRealmDefinitions(url)` — handlers don't have
  // to remember both steps. Callers that only need the peer broadcast
  // (because their own Realm instance is about to be unmounted anyway —
  // unpublish/delete handlers) use the standalone `notifyAllFileChanges`
  // free function above instead.
  async clearLocalSourceCachesAndBroadcast(): Promise<void> {
    this.clearLocalSourceCaches();
    await notifyAllFileChanges(this.#dbAdapter, this.url);
  }

  createJWT(claims: TokenClaims, expiration: ms.StringValue): string {
    return this.#adapter.createJWT(claims, expiration, this.#realmSecretSeed);
  }

  // Public mutation entry points (`write`, `writeMany`, `delete`, `deleteAll`)
  // serialize concurrent writers of the same file across replicas via the
  // per-file advisory locks. The locks span the FS write + index update so two
  // replicas can't both commit on top of the same pre-state.
  //
  // They are the same locks a batch takes, keyed the same way, which is what
  // makes the two paths exclude each other: a batch merging over a card's
  // stored bytes and a `writeMany` replacing them wholesale are writers of one
  // file, and letting them interleave would lose whichever landed first.
  //
  // A caller that needs its READ inside the same critical section as the write
  // — the `/_atomic` precheck — takes the locks at its own boundary and
  // invokes `_batchWriteUnlocked` directly, because re-entering through the
  // public methods would deadlock: a second `pg_advisory_xact_lock` on a key
  // already held blocks on its own pinned pool connection. A batch does the
  // same thing one level up, holding the locks across every read it stages
  // from and the commit it hands them to.
  async write(
    path: LocalPath,
    contents: string | Uint8Array,
    options?: WriteOptions,
  ): Promise<FileWriteResult> {
    let results = await this.#dbAdapter.withFileWriteLocks(
      this.url,
      [path],
      () => this._batchWriteUnlocked(new Map([[path, contents]]), options),
    );
    return results[0];
  }

  async writeMany(
    files: Map<LocalPath, string | Uint8Array>,
    options?: WriteOptions,
  ): Promise<FileWriteResult[]> {
    return this.#dbAdapter.withFileWriteLocks(this.url, [...files.keys()], () =>
      this._batchWriteUnlocked(files, options),
    );
  }

  private async _batchWriteUnlocked(
    files: Map<LocalPath, string | Uint8Array>,
    options?: WriteOptions,
  ): Promise<FileWriteResult[]> {
    let { writes } = await this._commitBatchUnlocked(
      { writes: files },
      options,
    );
    return writes;
  }

  // Whether the current unbroken run of render holds has outlived the cap.
  // False when no chain is running, which is the common case and the one that
  // lets a fresh chain start.
  #renderHoldChainExpired(): boolean {
    return (
      this.#renderHoldChainStartedAt !== undefined &&
      Date.now() - this.#renderHoldChainStartedAt > renderHoldMaxMs()
    );
  }

  // One commit covering every file a caller is changing — the bytes it writes,
  // the content it adds to the end of a file, and the paths it removes — under
  // a single index job and a single index event. A caller staging several
  // changes to several cards needs them to land together: two jobs would
  // compute their invalidation fan-outs against different snapshots of the
  // realm, and two events would let a subscriber observe the batch
  // half-applied.
  //
  // Writes land first, then appends, then removals. The write leg carries a
  // mid-loop index flush that a module followed by an instance depends on, so
  // it has an ordering constraint of its own; an append and a removal each
  // touch no definition and have nothing to contribute to that flush or to
  // gain from running ahead of it. Writing before appending is what makes a
  // caller's own ordering hold when it both replaces a file's content and adds
  // to the end of it: the append lands on the content the write left.
  //
  // Assumes the write locks on the files it touches are held — the caller
  // reads the pre-state it stages from inside the same critical section.
  // `write` and `writeMany` are the locked public entry points that reach
  // this; `delete` and `deleteAll` have their own unlocked primitives and do
  // not.
  //
  // Files are changed one at a time and there is no rollback: a file system
  // failure partway through leaves the files handled before it changed, and
  // this method rejects with the realm in that state. A caller offering its
  // own callers an all-or-nothing batch is offering it over what it validates
  // before calling here, not over the file system underneath.
  private async _commitBatchUnlocked(
    batch: CommitBatch,
    options?: WriteOptions,
  ): Promise<CommitBatchResult> {
    // A commit large enough to outlast a render pass holds this realm's
    // render lane for its duration. Coalescing can only merge into a job no
    // worker has claimed, so on an idle cluster a bulk import gets none of
    // it: each commit's render pass is claimed and finished before the next
    // commit ends, and cards touched by more than one commit are re-rendered
    // once per commit. Holding the lane leaves the earlier pass pending, so
    // the next one merges into it and the union renders once. Nothing is
    // skipped — the hold delays rendering, it never cancels it.
    let changeCount = (batch.writes?.size ?? 0) + (batch.deletes?.length ?? 0);
    if (
      changeCount < RENDER_HOLD_MIN_BATCH_SIZE ||
      // A commit that waits for its own indexing has nothing to hold the lane
      // for: it awaits the index pass inline, so the render job exists and the
      // realm is quiet again before the commit returns, and the hold would be
      // released in the same breath it was taken. The merge window a hold buys
      // opens only on the deferred path, where the pass — and the job it
      // spawns — outlive the commit.
      options?.waitForIndex !== false ||
      // Past the cap the chain stops holding, and it has to stop here rather
      // than in the heartbeat below: a fresh `acquire` writes a full lease
      // unconditionally, so a succession of new commits would keep the lane
      // held by never-renewed-but-freshly-minted leases while no single hold
      // ever looked old enough to stop. Skipping the acquire outright also
      // leaves the depth counter alone, so the anchor still clears when the
      // holds already in flight drain.
      this.#renderHoldChainExpired()
    ) {
      return await this.#commitBatchUnlockedInner(batch, options);
    }
    let hold = await JobClaimHold.acquire(
      this.#dbAdapter,
      prerenderHtmlConcurrencyGroup(this.url),
      RENDER_HOLD_LEASE_MS,
    );
    // The cap spans the chain, not the batch. Each commit acquires its own
    // holder, and holds compose — so a per-call start would reset the cap on
    // every batch, and a realm under back-to-back bulk commits could hold its
    // render lane indefinitely while no single hold ever looked old. Anchoring
    // on the first hold in an unbroken run is what makes the cap mean what it
    // says.
    this.#renderHoldChainStartedAt ??= Date.now();
    this.#renderHoldDepth++;
    let chainStartedAt = this.#renderHoldChainStartedAt;
    let heartbeat = setInterval(() => {
      // The other half of the cap, for a chain already under way: past it the
      // lease stops being renewed, so the lane frees itself within one lease
      // and the import pays an extra render pass rather than starving. The
      // acquire-time check above is what stops the next commit re-holding it.
      if (Date.now() - chainStartedAt > renderHoldMaxMs()) {
        return;
      }
      hold.refresh(RENDER_HOLD_LEASE_MS).catch((e: any) => {
        // The lease simply lapses and the lane frees early — the commit is
        // unaffected, so this must not surface as a write failure.
        this.#log.warn(
          `failed to refresh render hold for ${this.url}: ${e?.message}`,
        );
      });
    }, RENDER_HOLD_REFRESH_MS);
    heartbeat.unref?.();
    let releaseHold = async () => {
      clearInterval(heartbeat);
      // The chain ends when a hold is released with none behind it. A commit
      // that starts before this one finishes keeps the anchor, which is the
      // case the cap exists for.
      this.#renderHoldDepth--;
      if (this.#renderHoldDepth === 0) {
        this.#renderHoldChainStartedAt = undefined;
      }
      try {
        await hold.release();
      } catch (e: any) {
        // Left alone the lease expires on its own, so a failed release costs
        // one interval of delayed rendering rather than the commit.
        this.#log.warn(
          `failed to release render hold for ${this.url}: ${e?.message}`,
        );
      }
    };
    let result: CommitBatchResult;
    try {
      result = await this.#commitBatchUnlockedInner(batch, options);
    } catch (e) {
      await releaseHold();
      throw e;
    }
    // The commit's own render job does not exist yet: the index pass this
    // commit just queued is what enqueues it, moments from now. Releasing at
    // the end of the commit would free the lane in that gap, so the previous
    // commit's pass — the one the hold was keeping available as a merge
    // target — gets claimed just before the new job arrives, and the two
    // render the same cards one after the other. Hold until the indexing
    // settles instead, so both land on a held lane and merge into one pass.
    //
    // Deliberately not awaited: the caller's write is durable and its
    // response must not wait on indexing. Consecutive bulk commits chain —
    // each one's hold covers the next one's start — which is what collapses a
    // whole import into one render pass.
    let settled = this.incrementalIndexing();
    if (settled) {
      settled.then(releaseHold, releaseHold);
    } else {
      await releaseHold();
    }
    return result;
  }

  async #commitBatchUnlockedInner(
    batch: CommitBatch,
    options?: WriteOptions,
  ): Promise<CommitBatchResult> {
    let files = batch.writes ?? new Map<LocalPath, WriteContent>();
    let appends = batch.appends ?? new Map<LocalPath, string | Uint8Array>();
    let deletes = batch.deletes ?? [];
    // The /_atomic endpoint (and any other writeMany caller that opts
    // out of post-write indexing via waitForIndex:false) does not read
    // its response from the index, so it has no reason to wait for
    // prior incremental indexing to settle either. Skipping the gate
    // here is what keeps consecutive atomic writes responsive when a
    // previous mutation's deferred indexing job is back-pressured in
    // the worker pool — without it, every follow-up POST /_atomic
    // stalls on whichever earlier write/delete is still draining.
    // Callers that DO read indexed state after the write (the JSON-API
    // postCardInstance / patchCardInstance handlers) keep the original
    // deadlock-prevention semantics by omitting waitForIndex.
    let stageCursor = options?.stageCursor;
    if (options?.waitForIndex !== false) {
      await this.incrementalIndexing();
      // A batch coordinator drains before it stages, and this gate drains
      // again. Both wait on the same realm-wide indexing, so they are one
      // stage reached twice rather than two stages, and they accumulate
      // together — a write that queued behind indexing it did not ask for
      // spent that time here however many gates it passed through.
      stageCursor?.mark('drain');
    }
    let urls: URL[] = [];
    // Collect write results for all files we wrote
    let results: {
      path: LocalPath;
      lastModified: number;
      contentHash: string;
    }[] = [];
    let fileMetaRows: {
      path: LocalPath;
      contentHash?: string;
      contentSize?: number;
    }[] = [];
    let lastWriteType: 'module' | 'instance' | undefined;
    // Whether this batch has already minted a loader epoch. The token only
    // has to differ from whatever a prerender tab is holding, so one per
    // batch covers every module in it; minting per file would cost each warm
    // tab a loader reset per file for no extra freshness.
    let mintedLoaderEpoch = false;
    let addedFiles: LocalPath[] = [];
    let updatedFiles: LocalPath[] = [];
    let removedFiles: LocalPath[] = [];
    let invalidations: Set<string> = new Set();
    let invalidatedTypes = makeInvalidatedTypeAccumulator();
    let indexGeneration: number | undefined;
    let clientRequestId: string | null = options?.clientRequestId ?? null;
    let initiatingUser: string | null = options?.initiatingUser ?? null;
    // The module→instance flush below runs an index pass whose invalidation
    // set is every dependent of the modules written so far — including the
    // instances this very batch is about to write, whose on-disk content at
    // flush time is still the pre-write version. Rendering that set now would
    // render content the same write supersedes moments later, and the write's
    // own pass would render it a second time. So the flush defers its
    // prerender and parks the set here; whichever pass closes the write folds
    // it into the one prerender_html job the write pays for.
    let deferredPrerenderHtml: DeferredPrerenderHtml | undefined;
    let carriedPrerenderHtmlChanges = () =>
      deferredPrerenderHtml?.changes ?? [];
    let performIndex = async (
      changes: IndexChange[],
      opts?: { deferPrerenderHtml?: boolean },
    ) => {
      let {
        invalidations: workingInvalidations,
        generation,
        invalidatedTypes: workingTypes,
        deferredPrerenderHtml: deferred,
      } = await this.updateIndexAndCollectInvalidations(changes, {
        clientRequestId,
        initiatedBy: initiatingUser,
        ...(stageCursor ? { stageCursor } : {}),
        ...(opts?.deferPrerenderHtml ? { deferPrerenderHtml: true } : {}),
        // Handed over either way: a pass that renders folds this into the job
        // it spawns, and a pass that defers folds it into the set it returns.
        carriedPrerenderHtmlChanges: carriedPrerenderHtmlChanges(),
      });
      // A deferring pass returns the set it declined to render, already
      // unioned with whatever it was handed. A non-deferring pass normally
      // returns nothing, having folded the carried set into the job it
      // spawned — but it can still return a set if it coalesced onto a
      // running pass that was itself deferring, in which case no job was
      // spawned and the set is ours again.
      deferredPrerenderHtml = deferred;
      // Whatever the pass did not attribute to the enqueue or the wait is the
      // invalidation that followed it: dropping the realm's index caches,
      // touching the realm's updated-at, and re-resolving the executables the
      // pass invalidated.
      stageCursor?.mark('invalidate');
      invalidations = new Set([...invalidations, ...workingInvalidations]);
      invalidatedTypes.add({ invalidatedTypes: workingTypes });
      indexGeneration = generation ?? indexGeneration;
    };

    // Iterate modules (executable extensions) before everything else so
    // any instance in the same batch finds its module indexed when
    // fileSerialization runs. Without this, a batch that contains both
    // `foo.gts` and `FooCard/instance.json` iterated in the client's
    // natural (often alphabetical) order leaves the instance ahead of
    // the module, the flush-on-transition below never fires, and
    // fileSerialization throws FilterRefersToNonexistentTypeError.
    // Stable within each group — only the module/non-module partition
    // changes, not the relative order inside it.
    let orderedFiles = [...files].sort(([pathA], [pathB]) => {
      let aIsModule = hasExecutableExtension(pathA);
      let bIsModule = hasExecutableExtension(pathB);
      if (aIsModule === bIsModule) return 0;
      return aIsModule ? -1 : 1;
    });

    for (let [path, content] of orderedFiles) {
      let url = this.paths.fileURL(path);
      if (isSplicedSource(content)) {
        // A splice edits a stored card, so it neither needs a module flushed
        // to the index ahead of it — nothing about it is serialized — nor
        // stands in for the instance that does. `lastWriteType` is therefore
        // left as the last write that did serialize.
        let written = await this.#writeSplicedUnlocked(path, content);
        results.push(written.result);
        fileMetaRows.push(written.row);
        updatedFiles.push(path);
        urls.push(url);
        continue;
      }
      let currentWriteType: 'module' | 'instance' | undefined =
        hasExecutableExtension(path)
          ? 'module'
          : typeof content === 'string' &&
              path.endsWith('.json') &&
              isCardDocumentString(content)
            ? 'instance'
            : undefined;

      // Flush any modules written so far in this batch to the index
      // BEFORE we serialize the next instance. fileSerialization calls
      // lookupDefinition, which needs dependent modules to be indexed;
      // without this, the first instance after a module in the batch
      // throws FilterRefersToNonexistentTypeError and the whole atomic
      // batch rolls back.
      // TODO: we could be more precise here and keep track of what
      // modules the instances depend on and only flush when an instance
      // depends on a module that is part of this operation.
      if (lastWriteType === 'module' && currentWriteType === 'instance') {
        // The bytes written so far belong to this batch's durable write, not
        // to the index pass about to run. Closed here so each pass's files
        // are reported ahead of the queue insert that follows them, the same
        // order the single-pass case reports them in.
        stageCursor?.mark('persist');
        await performIndex(asUpdates(urls), { deferPrerenderHtml: true });
        urls = [];
      }

      if (typeof content === 'string') {
        try {
          let doc = JSON.parse(content);
          if (isCardResource(doc.data) && options?.serializeFile) {
            let serialized = await this.fileSerialization(
              { data: merge(doc.data, { meta: { realmURL: this.url } }) },
              url,
            );
            content = JSON.stringify(serialized, null, 2);
          }
        } catch (e: any) {
          if (
            e.message?.includes?.('not found') ||
            isFilterRefersToNonexistentTypeError(e)
          ) {
            throw e;
          }
        }
      }
      let sizeType: 'card' | 'file' =
        typeof content === 'string' &&
        path.endsWith('.json') &&
        isCardDocumentString(content)
          ? 'card'
          : 'file';
      this.assertWriteSize(content, sizeType, path);
      let isNewFile: boolean;
      if (typeof content === 'string') {
        // The stored file is opened before it is read, so its length can rule
        // the comparison out without any of it being held. Only a file of
        // exactly the staged content's length can be the staged content, and
        // a replacement almost never is — so this is what keeps replacing a
        // file that is large from costing its size. `openFile` reports the
        // length from a stat it already performs, and reading the body stays
        // a separate step because the body is a lazy, single-use stream on
        // every streaming adapter.
        let stored = await this.#adapter.openFile(path);
        let couldMatch =
          stored !== undefined &&
          (stored.size === undefined ||
            stored.size === computeContentSize(content));
        let existingFile = couldMatch
          ? await readFileAsText(path, (p) => this.#adapter.openFile(p))
          : undefined;
        if (existingFile?.content === content) {
          // Identical bytes: the file is left alone, so its modification time
          // stands and nothing is queued for indexing. The content hash is
          // still the file's own — the bytes in hand are the bytes on disk —
          // so a caller reading a version off this result gets the one the
          // file already holds rather than nothing.
          //
          // Recorded on the row as well as returned. A file written before
          // the realm began recording hashes carries none, and the row is
          // what the file's metadata resource reports as its content hash —
          // so a file the realm has never rewritten would answer without one
          // until something changed its bytes. Writing the hash it already
          // has is a no-op for every file that has one. This is not what
          // makes `baseVersion` work: that is computed from the bytes read
          // inside the write lock and never consults the row.
          let unchangedHash = computeContentHash(content);
          results.push({
            path,
            lastModified: existingFile.lastModified,
            contentHash: unchangedHash,
          });
          fileMetaRows.push({
            path,
            contentHash: unchangedHash,
            contentSize: computeContentSize(content),
          });
          continue;
        }
        // From the open above rather than from the read, which a file whose
        // length already settled the comparison never had.
        isNewFile = stored === undefined;
      } else {
        isNewFile = !(await this.#adapter.exists(path));
      }
      let contentHash = computeContentHash(content);
      let contentSize = computeContentSize(content);
      this.sendIndexInitiationEvent(url.href);
      await this.trackOwnWrite(path);
      let { lastModified } = await this.#adapter.write(path, content);
      (isNewFile ? addedFiles : updatedFiles).push(path);
      this.invalidateCache(path);
      await this.#notifyFileChange(path);
      if (currentWriteType === 'module') {
        // The definition cache is keyed by module URL with no freshness
        // check on the row — `readFromDatabaseCache` never compares content
        // hashes or mtimes, and only error rows carry a TTL — so a cached
        // definition for this module stays authoritative until something
        // deletes it. Dropping it here, where the bytes change, keeps a
        // written module's cached definition in step with the file rather
        // than with the index: the next `lookupDefinition` misses and reads
        // the rewritten module through `prerenderModule`, off disk.
        //
        // Leaving this to the index job's `onInvalidation` instead would
        // leave a window — the whole of it on the deferred-indexing paths —
        // in which `fileSerialization` resolves an instance against the
        // module's previous schema. `serializeCardResource` skips every
        // attribute whose field that schema doesn't declare, so the
        // instance lands on disk missing the new field and the write still
        // reports success; a dropped attribute is indistinguishable from an
        // unset one, so nothing downstream can tell it happened.
        //
        // Ordered after `#notifyFileChange` deliberately. This replica dropped
        // its own byte caches synchronously in `invalidateCache(path)` above,
        // but peer replicas only drop theirs when they receive that
        // notification. Deleting the definition row is what makes the next
        // `lookupDefinition` — on any replica — prerender the module; a peer
        // that prerenders while still holding pre-write bytes derives the old
        // schema and caches THAT, reinstating the staleness this call removes
        // and making it durable until indexing lands. Publishing the byte
        // invalidation first narrows that to peers which have not yet
        // processed the notification; it does not close it, since the notify
        // is best-effort and applied asynchronously. The index job's own
        // invalidation stays the backstop.
        //
        // Best-effort, like `#notifyFileChange` above. The bytes are already
        // durable at this point but `urls` has not been appended to yet, so
        // letting either step throw would abandon the batch before ANY index
        // job is enqueued — for this file and for every file written ahead of
        // it — and the caller's natural remedy makes it worse: a retry with
        // the same bytes takes the unchanged-content short-circuit above, so
        // it enqueues nothing either and the file stays on disk and out of
        // the index until an unrelated edit or a full reindex. Swallowing
        // leaves only the staleness these steps exist to remove, which the
        // index job's own invalidation still clears. They are caught
        // separately so a failure in one still leaves the other's benefit:
        // the delete alone still drops the row a stale definition sits in,
        // and the epoch alone still stops a later invalidation from
        // re-deriving that definition off a warm tab.
        //
        // Deleting the cached definition only guarantees the next lookup
        // re-derives one; it says nothing about what that lookup derives it
        // FROM. `lookupDefinition` repopulates by prerendering the module,
        // and a prerender tab that already evaluated this module keeps
        // serving the evaluated copy — the route re-reads the file's metadata
        // (so the response even carries the post-write mtime) but imports out
        // of the loader it is holding. The result is the pre-write schema,
        // cached under the post-write module's URL and durable until
        // something else invalidates it: the staleness the delete removes,
        // reinstated one layer down.
        //
        // Minting a loader epoch is how this codebase already says "warm tabs
        // are stale for this realm" — an index pass whose invalidation set
        // contains an executable mints one, and the render routes reset a
        // tab's loader once per epoch it has not cleared for. The write path
        // has to mint too, because every definition resolved between the
        // write and that index pass — the whole of the window on the
        // deferred-indexing paths — is resolved before the pass's epoch
        // exists. Ordered before the delete so the epoch is already current
        // for any lookup that observes the missing row.
        if (!mintedLoaderEpoch) {
          try {
            await mintRealmLoaderEpoch(this.#dbAdapter, this.url);
            // Only on success: a transient failure here gets another attempt
            // from the next module in the batch rather than leaving every
            // module in it renderable off a warm tab.
            mintedLoaderEpoch = true;
          } catch (err: unknown) {
            this.#log.error(
              `failed to mint a loader epoch for ${this.url} after writing ${url.href}; a prerender tab holding the pre-write module may re-derive its previous schema: ${stringifyErrorForLog(err)}`,
            );
          }
        }
        try {
          await this.#definitionLookup.invalidate(url.href);
        } catch (err: unknown) {
          this.#log.error(
            `failed to invalidate the definition cache for ${url.href}; a stale cached definition may drop unknown attributes from instances serialized before indexing lands: ${stringifyErrorForLog(err)}`,
          );
        }
      }
      results.push({ path, lastModified, contentHash });
      fileMetaRows.push({ path, contentHash, contentSize });
      urls.push(url);
      lastWriteType = currentWriteType ?? lastWriteType;
    }

    // The append leg. Each path gets the same per-file treatment a write does
    // — the ceiling, the initiation event, the own-write tracking, the
    // byte-cache drop, the peer notification, and a `realm_file_meta` row —
    // with two differences, both of which follow from never holding the file.
    //
    // The ceiling is applied to what is being added rather than to what the
    // file will hold, and it is the file ceiling whatever the path's
    // extension: the limit is over the bytes a caller hands the realm, and a
    // file that grew past it one line at a time is what an append-only file
    // is. Nothing here classifies the content as a card, because appending to
    // a card's stored JSON is not something the operation core permits —
    // bytes added after a document's closing brace are no longer a document.
    //
    // And the fingerprint is assembled from bounded reads of the file once the
    // append has landed, rather than computed from bytes in hand. That is the
    // same value hashing the whole content would produce, and its cost has a
    // ceiling no file can exceed: `computeContentHashFromRanges` asks for at
    // most `CONTENT_HASH_WHOLE_LIMIT_BYTES` however large the file is, so
    // adding a line to a file of any size costs the line plus a bounded read.
    for (let [path, content] of appends) {
      let url = this.paths.fileURL(path);
      this.assertWriteSize(content, 'file', path);
      let existed = await this.#adapter.exists(path);
      this.sendIndexInitiationEvent(url.href);
      await this.trackOwnWrite(path);
      let { lastModified, size } = await this.#adapter.append(path, content);
      this.invalidateCache(path);
      await this.#notifyFileChange(path);
      let contentHash = await computeContentHashFromRanges(
        size,
        async (start, length) =>
          await readRangeBytes(this.#adapter, path, start, length),
      );
      // The write leg may have reached this file already, which is one file
      // changing twice rather than two files changing — a caller that replaces
      // a log and then adds a line to it. Everything the write recorded
      // describes bytes the file no longer holds, so the readings here replace
      // them rather than joining them: one result, one `realm_file_meta` row
      // (two rows for one path in the same statement is an error Postgres
      // raises outright), one entry in the announcement, and one index change.
      let written = results.findIndex((result) => result.path === path);
      if (written === -1) {
        results.push({ path, lastModified, contentHash });
        fileMetaRows.push({ path, contentHash, contentSize: size });
      } else {
        results[written] = { path, lastModified, contentHash };
        let row = fileMetaRows.findIndex((meta) => meta.path === path);
        fileMetaRows[row] = { path, contentHash, contentSize: size };
      }
      // Asked separately from the readings above, because recording a result
      // and announcing a change are not the same question. A write that found
      // the file already holding the bytes it staged records a result and
      // announces nothing — it left the file alone. This leg did not: the
      // append changed the file whatever the write before it did, so the
      // announcement is made here unless one of the earlier legs already made
      // it. Without this, a batch that replaces a file with its own content
      // and then appends to it broadcasts no file change at all.
      if (!addedFiles.includes(path) && !updatedFiles.includes(path)) {
        (existed ? updatedFiles : addedFiles).push(path);
      }
      // Pushed unless it is already pending, which is a different question
      // from whether the write leg handled it: a mid-loop flush empties this,
      // and a file indexed from its pre-append state needs indexing again.
      if (!urls.some((pending) => pending.href === url.href)) {
        urls.push(url);
      }
    }

    // The removal leg. Each path gets the same per-file treatment a write
    // does — the initiation event, the own-write tracking that stops the file
    // watcher from re-reporting this replica's own change, the byte-cache
    // drop, and the peer notification — and then the whole batch's file
    // changes are announced together below.
    let deleteURLs: URL[] = [];
    for (let path of deletes) {
      let url = this.paths.fileURL(path);
      this.sendIndexInitiationEvent(url.href);
      await this.trackOwnWrite(path, { isDelete: true });
      await this.#adapter.remove(path);
      this.invalidateCache(path);
      await this.#notifyFileChange(path);
      removedFiles.push(path);
      deleteURLs.push(url);
    }

    if (
      addedFiles.length > 0 ||
      updatedFiles.length > 0 ||
      removedFiles.length > 0
    ) {
      if (
        [...addedFiles, ...updatedFiles, ...removedFiles].some(
          (f) => f === 'realm.json',
        )
      ) {
        this.invalidateCachedRealmInfo();
      }
      this.broadcastRealmEvent({
        eventName: 'update',
        ...(addedFiles.length ? { added: addedFiles } : {}),
        ...(updatedFiles.length ? { updated: updatedFiles } : {}),
        ...(removedFiles.length ? { removed: removedFiles } : {}),
        realmURL: this.url,
      } as UpdateRealmEventContent);
    }

    // persist file meta (created_at) to DB independent of index and retrieve created
    let createdMap = await this.persistFileMeta(fileMetaRows);
    await this.removeFileMeta(removedFiles);
    // Everything the caller asked for is durable at this point: the bytes, the
    // removals, and the rows describing them. What follows is indexing, which
    // the caller may or may not be waiting for — so this is the boundary that
    // says how much of a slow write was the write.
    stageCursor?.mark('persist');
    let waitForIndex = options?.waitForIndex !== false;
    let changes: IndexChange[] = [
      ...asUpdates(urls),
      ...deleteURLs.map((url) => ({ url, operation: 'delete' as const })),
    ];
    if (changes.length > 0) {
      if (waitForIndex) {
        await performIndex(changes);
        this.broadcastIncrementalInvalidationEvent([...invalidations], {
          clientRequestId,
          generation: indexGeneration,
          invalidatedTypes: invalidatedTypes.value,
        });
        // Announcing what the pass invalidated is the last of the
        // invalidation, so it accumulates into the same stage as the hooks
        // that ran before it.
        stageCursor?.mark('invalidate');
      } else {
        // Two-phase: await the durable queue insert inline so pre-enqueue
        // failures (DB partial outage) propagate back to this method's
        // caller and ultimately to the HTTP client — without that, a write
        // could land on disk and never get indexed, leaving the realm
        // silently stale. The worker settle is fire-and-forget; worker-
        // time failures surface via error_doc inside the worker as before.
        // Deferred is registered synchronously inside enqueueUpdate before
        // any await, so realm.incrementalIndexing() reflects this work as
        // pending the moment we return.
        // Snapshot any invalidations from in-loop intermediate flushes (the
        // module-then-instance gate at line 1262) so the broadcast unions
        // them with the deferred-flush results. Without this, mixed-batch
        // writeMany calls with waitForIndex:false would silently drop the
        // earlier flushes' invalidations and leave subscribers with stale
        // state for those URLs. Single-file callers (+source / binary)
        // never hit the intermediate path, so this snapshot is empty for
        // them — but it's correct for the primitive in general.
        let priorInvalidations = [...invalidations];
        let priorTypes = invalidatedTypes.value;
        let carried = carriedPrerenderHtmlChanges();
        // Handed off: this pass's prerender job renders the deferred set too.
        deferredPrerenderHtml = undefined;
        let { settled } = await this.enqueueIndexUpdateAndCollectInvalidations(
          changes,
          {
            clientRequestId,
            initiatedBy: initiatingUser,
            ...(carried.length ? { carriedPrerenderHtmlChanges: carried } : {}),
            // Route the post-worker broadcast through onSettled so it runs
            // INSIDE the indexing deferred lifecycle. Without this, the
            // broadcast would fire from an outer .then() after the deferred
            // is already removed — meaning realm.incrementalIndexing()
            // resolves before the broadcast, and an afterEach drain that
            // awaits the drain still races with the broadcast against
            // test teardown (mock-matrix already destroyed → broadcast
            // throws on serverState).
            onSettled: (deferredInvalidations, meta) => {
              let types = makeInvalidatedTypeAccumulator();
              types.add({ invalidatedTypes: priorTypes });
              types.add(meta);
              this.broadcastIncrementalInvalidationEvent(
                [...new Set([...priorInvalidations, ...deferredInvalidations])],
                {
                  clientRequestId,
                  generation: meta.generation ?? indexGeneration,
                  invalidatedTypes: types.value,
                },
              );
            },
          },
        );
        // The durable queue insert is all of the indexing this path waits
        // for; the worker, the invalidation and the broadcast run after the
        // caller has its answer, so they are nobody's latency and this write
        // reports no wait for them.
        stageCursor?.mark('enqueue');
        settled.catch((err: unknown) => {
          // Covers worker job rejection AND post-worker realm-side work
          // (onInvalidation / handleExecutableInvalidations / broadcast).
          this.#log.error(
            `Deferred indexing chain failed for ${this.url} (urls: ${changes
              .map(({ url }) => url.href)
              .join(', ')}): ${stringifyErrorForLog(err)}`,
          );
        });
      }
    } else {
      // Nothing changed on disk (e.g., every file's content was already what
      // the caller staged). Preserve the pre-existing always-broadcast
      // behavior.
      this.broadcastIncrementalInvalidationEvent([...invalidations], {
        clientRequestId,
        generation: indexGeneration,
        invalidatedTypes: invalidatedTypes.value,
      });
    }
    // A mixed batch whose instances all turned out to be byte-identical
    // leaves the flush's deferred set with no later pass to fold it into.
    // Those URLs are real dependents of a module that did change, so the
    // commit still owes them a render — enqueue the job the flush skipped.
    await this.enqueueDeferredPrerenderHtml(deferredPrerenderHtml);
    return {
      writes: results.map(({ path, lastModified, contentHash }) => ({
        path,
        lastModified,
        contentHash,
        created: createdMap.get(path)?.createdAt ?? null,
      })),
      generation: indexGeneration ?? null,
    };
  }

  // Enqueue the prerender_html job an intermediate index pass deferred, for
  // the case where no later pass in the same write picked the set up. Uses
  // the deferring pass's own generation and loader epoch — the stamp those
  // URLs were invalidated under. Fire-and-forget, and best-effort, for the
  // same reason the in-worker enqueue is: an index pass must never fail on
  // its prerender enqueue, and a missed one self-heals on the next pass.
  private async enqueueDeferredPrerenderHtml(
    deferred: DeferredPrerenderHtml | undefined,
  ): Promise<void> {
    if (!deferred || deferred.changes.length === 0) {
      return;
    }
    try {
      await enqueuePrerenderHtmlJob(this.#queue, {
        realmURL: this.url,
        realmUsername: await this.getRealmOwnerUsername(),
        changes: deferred.changes,
        generation: deferred.generation,
        loaderEpoch: deferred.loaderEpoch,
        spawningJobId: null,
        spawningPriority: prerenderSpawnedPriority({
          realmURL: this.url,
          indexPriority: userInitiatedPriority,
        }),
        timeoutSec: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        preWarm: false,
      });
    } catch (e: any) {
      this.#log.warn(
        `failed to enqueue deferred prerender_html job for ${this.url}: ${e?.message}`,
      );
    }
  }

  // persist created_at into realm_file_meta table using db adapter
  private async persistFileMeta(
    rows: { path: LocalPath; contentHash?: string; contentSize?: number }[],
  ): Promise<
    Map<
      LocalPath,
      { createdAt: number; contentHash?: string; contentSize?: number }
    >
  > {
    if (!this.#dbAdapter || rows.length === 0) return new Map();
    const createdMap = await persistFileMeta(
      this.#dbAdapter,
      this.url,
      rows.map((r) => ({
        path: r.path,
        contentHash: r.contentHash,
        contentSize: r.contentSize,
      })),
    );
    // maintain LocalPath typing on keys
    return new Map(
      Array.from(createdMap.entries()).map(([p, c]) => [p as LocalPath, c]),
    );
  }

  // remove file meta rows for deleted paths
  private async removeFileMeta(paths: LocalPath[]): Promise<void> {
    if (!this.#dbAdapter || paths.length === 0) return;
    await removeFileMeta(this.#dbAdapter, this.url, paths);
  }

  private lowestStatusCode(errors: AtomicPayloadValidationError[]): number {
    let statuses = errors
      .map((e) => e.status)
      .filter((status) => typeof status === 'number') as number[];
    return statuses.length > 0 ? Math.min(...statuses) : 400;
  }

  // Atomic operation hrefs may arrive in canonical RRI (prefix) form, since
  // that is the form this realm now serves instance ids in. Resolve those to a
  // real URL before doing path math; plain URL / relative hrefs pass through
  // unchanged (they are not registered prefixes).
  #resolveAtomicHref(href: string): string {
    return this.#virtualNetwork.isRegisteredPrefix(href)
      ? this.#virtualNetwork.toURL(href).href
      : href;
  }

  // The files an atomic request will write, for the locks it takes before its
  // precheck reads any of them. Path math over what each operation names, by
  // the same resolution the write loop applies, so the set cannot disagree
  // with the paths actually written.
  //
  // An href that does not resolve is left out rather than refused here. The
  // precheck inside the lock is what reports it, and a file this request
  // cannot name is one no lock of its would exclude anyone from.
  #atomicWritePaths(operations: AtomicOperation[]): LocalPath[] {
    let paths = new Set<LocalPath>();
    for (let operation of filterAtomicOperations(operations)) {
      if (!operation.href) {
        continue;
      }
      try {
        paths.add(
          this.paths.local(
            new URL(this.#resolveAtomicHref(operation.href), this.paths.url),
          ),
        );
      } catch {
        continue;
      }
    }
    return [...paths];
  }

  private async checkBeforeAtomicWrite(
    operations: AtomicOperation[],
  ): Promise<AtomicPayloadValidationError[]> {
    let errors: AtomicPayloadValidationError[] = [];
    await Promise.all(
      operations.map(async (operation) => {
        if (
          (operation.op !== 'add' && operation.op !== 'update') ||
          !operation.href
        ) {
          return;
        }

        let localPath: LocalPath;
        try {
          localPath = this.paths.local(
            new URL(this.#resolveAtomicHref(operation.href), this.paths.url),
          );
        } catch (error: any) {
          errors.push({
            title: 'Invalid atomic:operations format',
            detail:
              error?.message ??
              `Request operation contains invalid href '${operation.href}'`,
            status: error?.status ?? 400,
          });
          return;
        }

        // Same reservation `internalHandle` enforces for direct writes,
        // read from the one place it is stated.
        let reserved = reservedWriteDestination(localPath);
        if (reserved) {
          errors.push({
            title: 'Reserved path',
            detail: `Cannot write '${operation.href}': ${reserved}`,
            status: 422,
          });
          return;
        }

        let exists = await this.#adapter.exists(localPath);
        if (operation.op === 'add' && exists) {
          errors.push({
            title: 'Resource already exists',
            detail: `Resource ${operation.href} already exists`,
            status: 409,
          });
        } else if (operation.op === 'update' && !exists) {
          errors.push({
            title: 'Resource does not exist',
            detail: `Resource ${operation.href} does not exist`,
            status: 404,
          });
        }
      }),
    );
    return errors;
  }

  validate(json: any): AtomicPayloadValidationError[] {
    let operations = json['atomic:operations'];
    let title = 'Invalid atomic:operations format';
    let errors: AtomicPayloadValidationError[] = [];
    if (!operations || !Array.isArray(operations)) {
      let detail = `Request body must contain 'atomic:operations' array`;
      errors.push({
        title,
        detail,
        status: 400,
      });
      return errors;
    }
    for (let operation of operations) {
      if (operation.op !== 'add' && operation.op !== 'update') {
        let detail = `You tried to use an unsupported operation type: '${operation.op}'. Only 'add' and 'update' operations are currently supported`;
        errors.push({
          title,
          detail,
          status: 422,
        });
      }
      if (!operation.href) {
        let detail = `Request operation must contain 'href' property`;
        errors.push({
          title,
          detail,
          status: 400,
        });
      }
      if (
        operation.data &&
        !(operation.data.type == 'card' || operation.data.type == 'source')
      ) {
        let detail = `You tried to use an unsupported resource type: '${operation.data.type}'. Only 'card' and 'source' resource types are currently supported`;
        errors.push({
          title,
          detail,
          status: 422,
        });
      }
    }
    return errors;
  }

  private async handleAtomicOperations(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return createResponse({
        body: JSON.stringify({
          errors: [
            {
              title: 'Invalid atomic:operations format',
              detail: `Request body is not valid JSON`,
            },
          ],
        }),
        init: {
          status: 400,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
        requestContext,
      });
    }
    let validationErrors = this.validate(json);
    if (validationErrors.length > 0) {
      return createResponse({
        body: JSON.stringify({ errors: validationErrors }),
        init: {
          status: 400,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        }, //consolidate to 400
        requestContext,
      });
    }
    let atomicOperations = json['atomic:operations'] as AtomicOperation[];
    let atomicWritePaths = this.#atomicWritePaths(atomicOperations);

    // Take the advisory lock on every file the operations name, from the
    // precheck through the write. Without this, two replicas could both pass
    // `checkBeforeAtomicWrite` for the same `add` operation (file does
    // not exist), then both proceed to write — last writer wins on disk
    // but indexer state is incoherent. Inside the lock we invoke
    // `_batchWriteUnlocked` directly to avoid re-acquiring a held
    // advisory lock through `writeMany` (which would deadlock on a
    // different pinned pool connection).
    //
    // The set is resolved here, before the lock, by the same path math the
    // loop below applies to each operation. An href that does not resolve is
    // left out rather than refused: the precheck inside the lock is what
    // reports it, and locking nothing for a file this request cannot name
    // excludes nobody.
    return await this.#dbAdapter.withFileWriteLocks(
      this.url,
      atomicWritePaths,
      async () => {
        let atomicCheckErrors =
          await this.checkBeforeAtomicWrite(atomicOperations);
        if (atomicCheckErrors.length > 0) {
          return createResponse({
            body: JSON.stringify({ errors: atomicCheckErrors }),
            init: {
              status: this.lowestStatusCode(atomicCheckErrors),
              headers: { 'content-type': SupportedMimeType.JSONAPI },
            },
            requestContext,
          });
        }

        let operations = filterAtomicOperations(atomicOperations);
        let files = new Map<LocalPath, string>();
        let writeResults: FileWriteResult[] = [];

        for (let operation of operations) {
          let resource = operation.data;
          let href = operation.href;
          let localPath = this.paths.local(
            new URL(this.#resolveAtomicHref(href), this.paths.url),
          );
          let exists = await this.#adapter.exists(localPath);
          if (operation.op === 'add' && exists) {
            return createResponse({
              body: JSON.stringify({
                errors: [
                  {
                    title: 'Resource already exists',
                    detail: `Resource ${href} already exists`,
                    status: 409,
                  },
                ],
              }),
              init: {
                status: 409,
                headers: { 'content-type': SupportedMimeType.JSONAPI },
              },
              requestContext,
            });
          }
          if (operation.op === 'update' && !exists) {
            return createResponse({
              body: JSON.stringify({
                errors: [
                  {
                    title: 'Resource does not exist',
                    detail: `Resource ${href} does not exist`,
                    status: 404,
                  },
                ],
              }),
              init: {
                status: 404,
                headers: { 'content-type': SupportedMimeType.JSONAPI },
              },
              requestContext,
            });
          }
          if (isModuleResource(resource)) {
            let content = resource.attributes?.content ?? '';
            this.assertWriteSize(content, 'file', localPath);
            files.set(localPath, content);
          } else if (isCardResource(resource)) {
            let doc = {
              data: resource,
            };
            let jsonString = JSON.stringify(doc, null, 2);
            this.assertWriteSize(jsonString, 'card', localPath);
            files.set(localPath, jsonString);
          } else {
            return createResponse({
              body: JSON.stringify({
                errors: [
                  {
                    status: 400,
                    title: 'Invalid resource',
                    detail: `Operation data is not a valid card resource or module resource`,
                  },
                ],
              }),
              init: {
                status: 400,
                headers: { 'content-type': SupportedMimeType.JSONAPI },
              },
              requestContext,
            });
          }
        }

        if (files.size > 0) {
          try {
            // /_atomic returns once writes are durable, not once they are
            // indexed. Callers that need indexed state must drain via
            // realm.incrementalIndexing() (server-side), wait on the
            // matrix 'index' incremental event (client-side), or opt-in
            // to a synchronous response by passing `?waitForIndex=true`
            // on the POST URL. The query-param path is intended for
            // one-shot CLI / agent flows where Matrix subscription is
            // impractical and a search poll-loop would race indexing
            // latency. Mixed module+instance batches are still
            // serialized correctly: the in-loop intermediate flush in
            // _batchWriteUnlocked at the `lastWriteType === 'module' &&
            // currentWriteType === 'instance'` gate is always awaited,
            // so an instance's fileSerialization sees its module already
            // indexed.
            let waitForIndex =
              new URL(request.url).searchParams.get('waitForIndex') === 'true';
            writeResults = await this._batchWriteUnlocked(files, {
              clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
              serializeFile: true,
              waitForIndex,
              initiatingUser: requestContext.authenticatedUser ?? null,
            });
          } catch (e: any) {
            if (e instanceof CardError) {
              return responseWithError(e, requestContext);
            }
            // Log the underlying exception before returning 500 —
            // otherwise callers only see "Write Error" and the original
            // stack trace is lost, making atomic-batch failures
            // effectively undebuggable. Include e.cause explicitly: errors
            // like FilterRefersToNonexistentTypeError carry the actionable
            // detail (which module/definition was missing, or that a
            // concurrent invalidation discarded the lookup) in their cause,
            // not their message, so without this the real reason is swallowed.
            let cause =
              e?.cause instanceof Error
                ? `${e.cause.message}\n${e.cause.stack ?? '(no stack)'}`
                : e?.cause != null
                  ? String(e.cause)
                  : undefined;
            this.#log.error(
              `Atomic write failed: ${e.message}${
                cause ? `\ncause: ${cause}` : ''
              }\n${e.stack ?? '(no stack)'}`,
            );
            return createResponse({
              body: JSON.stringify({
                errors: [{ title: 'Write Error', detail: e.message }],
              }),
              init: {
                status: 500,
                headers: { 'content-type': SupportedMimeType.JSONAPI },
              },
              requestContext,
            });
          }
        }

        let results: AtomicOperationResult[] = writeResults.map(
          ({ path, created }) => ({
            data: {
              // Serve the created instance id in canonical RRI (prefix) form, to
              // match getCard / create / patch (no-op for unmapped realms).
              id: this.#virtualNetwork.unresolveURL(
                this.paths.fileURL(path).href,
              ),
            },
            meta: {
              created,
            },
          }),
        );
        return createResponse({
          body: JSON.stringify({ 'atomic:results': results }, null, 2),
          init: {
            status: 201,
            headers: {
              'content-type': SupportedMimeType.JSONAPI,
            },
          },
          requestContext,
        });
      },
    );
  }

  // The operations envelope: a batch of named operations, committed all or
  // nothing.
  //
  // This is the second front door onto the operation core and it adds no
  // behavior of its own. It reads the batch off the wire, asks the core which
  // behavior each entry's name resolves to for its target, runs the reads and
  // hands the writes to the coordinator — the same `runOperation` and
  // `commitBatch` the card verbs dispatch into, so the two transports cannot
  // drift into meaning different things by the same operation.
  //
  // **Access posture.** Operations are identity-aware but not access-enforced.
  // The realm's own read/write permission is the whole of what is checked: any
  // caller who may write the realm may invoke any operation that writes it,
  // and any caller who may read it may invoke any read. An operation's program
  // can read `actor()` and an `assert` can refuse on what it finds, but the
  // realm verifies no claim beyond the one its permission check already made,
  // and refuses nothing on the strength of who is asking. Treat every
  // operation's result as reachable by any permitted caller of this realm.
  private async handleOperations(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    try {
      return await this.#runOperationsBatch(request, requestContext);
    } catch (err: unknown) {
      if (!isOperationFailure(err)) {
        throw err;
      }
      // A batch is all-or-nothing, so the first refusal is the whole answer:
      // nothing was written, no index job was enqueued and no event was
      // broadcast, whichever stage produced it.
      return this.#operationsResponse(
        errorsDocument(err.error),
        err.error.status,
        requestContext,
      );
    }
  }

  async #runOperationsBatch(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    if (!carriesOperationsExt(request.headers.get('Content-Type'))) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid content type',
        detail:
          `a batch of operations is sent as ` +
          `"${SupportedMimeType.BoxelOperations}"; this request's ` +
          `content type does not name that extension`,
      });
    }
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid operations envelope',
        detail: `the request body is not valid JSON`,
      });
    }
    // A batch is a tree: the top level is a serial run, and an entry in it may
    // be a group whose members are entries in their own right. The tree is
    // what the answer mirrors and what the coordinator schedules staging by;
    // everything between reads the entries in it, in the order they were sent.
    let tree = parseOperationsEnvelope(body, this.url, {
      resolveIdentifier: (href) => this.#resolveAtomicHref(href),
    });
    let entries = invocationsIn(tree);
    let caller = this.#callerOf(request, requestContext);
    // One row peek per target for the whole resolution pass: entries often
    // name the same card, and which behavior a name resolves to is read off
    // the target's stored type.
    let scope = newOperationScope(this.operationCore);
    // Settled rather than raced, so the entry a refusal names is the earliest
    // one the caller got wrong rather than whichever index read came back
    // first. A batch with two bad entries would otherwise report a different
    // one run to run.
    let outcomes = await Promise.allSettled(
      entries.map((entry) => this.#resolveEnvelopeEntry(entry, scope)),
    );
    let refused = outcomes.find((outcome) => outcome.status === 'rejected');
    if (refused) {
      throw refused.reason;
    }
    let resolved = outcomes.map(
      (outcome) =>
        (outcome as PromiseFulfilledResult<ResolvedEnvelopeEntry>).value,
    );

    // `QUERY` is the read-only spelling, and the realm derives the permission
    // it checks from the method — so a write reaching here arrived on a
    // request that was only authorized to read. Refused before anything is
    // staged rather than let through to a permission check that already
    // passed for the wrong question.
    if (request.method === 'QUERY') {
      let write = resolved.find(({ definition }) => isWrite(definition.base));
      if (write) {
        throw new OperationFailure({
          ...(write.entry.href ? { id: write.entry.href } : {}),
          status: 400,
          code: 'wrong-entry-point',
          title: 'Write in a read-only batch',
          detail:
            `operation "${write.entry.name}" writes, and a QUERY batch is ` +
            `authorized to read; send a batch that writes as a POST`,
          meta: { entry: write.entry.position },
        });
      }
    }

    // An anonymous caller on a realm anyone may read or write has no identity
    // for an operation to read, and whether an operation reads one is settled
    // by its stored definition — so the batch is refused here, before any of
    // it runs, rather than part-way through by whichever entry reached the
    // actor first. No identity is invented to stand in: a fabricated id would
    // be written into cards and compared in filters as though someone had
    // acted.
    if (!caller.actor) {
      let needing = resolved.find(({ definition }) => needsActor(definition));
      if (needing) {
        throw new OperationFailure({
          ...(needing.entry.href ? { id: needing.entry.href } : {}),
          status: 401,
          code: 'actor-required',
          title: 'Operation needs an identity',
          detail:
            `operation "${needing.entry.name}" reads the invoking actor, and ` +
            `this request authenticated nobody`,
          meta: { entry: needing.entry.position },
        });
      }
    }

    // Reads run first and against the state the batch started from, which is
    // what "an entry sees pre-batch state" means for a mixed batch: a read
    // entry never observes what a write entry in the same batch stages, and
    // reading before the coordinator takes the write lock is what keeps a read
    // from waiting on one.
    //
    // In request order, whatever the tree says. A group is a staging
    // schedule, and a read stages nothing: it reads the state the batch
    // started from wherever in the tree it sits, so which group holds it
    // cannot change its answer. What it would change is how many reads this
    // realm has in flight for one request, which is a decision about the
    // realm's own load rather than about what the caller asked for.
    //
    // Keyed by position rather than by index, because a position is a path
    // through the tree for an entry inside a group and there is no array for
    // one to be an index into.
    let results = new Map<EntryPosition, EnvelopeResult>();
    for (let { entry, target, definition } of resolved) {
      if (isWrite(definition.base)) {
        continue;
      }
      let result: OperationResult;
      try {
        result = await runOperation(this.operationCore, {
          target,
          name: entry.name,
          ...(entry.data ? { params: paramsFor(entry) } : {}),
          ...caller,
        });
      } catch (err: unknown) {
        throw atEntry(err, entry.position);
      }
      results.set(entry.position, readResult(entry, result));
    }

    let writes = resolved.filter(({ definition }) => isWrite(definition.base));
    if (writes.length > 0) {
      let staged = new Map<EntryPosition, BatchEntry>();
      for (let { entry, definition } of writes) {
        try {
          staged.set(entry.position, batchEntryFor(entry, definition));
        } catch (err: unknown) {
          throw atEntry(err, entry.position);
        }
      }
      // The tree the caller sent, with the entries that only read taken out of
      // it: the groups are the batch's staging schedule, so the coordinator is
      // handed the shape rather than a flat list of what writes.
      //
      // Every staged entry carries the position the caller sent it under, so a
      // refusal from the coordinator names that one rather than the position
      // it took among the entries that write — in the key, in the key beside
      // it naming a conflicting entry, and in the prose.
      let committed = await commitBatch(
        this.batchCore,
        stagedTree(tree, staged),
        {
          clientRequestId: caller.clientRequestId || null,
          actor: caller.actor || undefined,
        },
      );
      // The coordinator answers in the flat order of the entries it staged,
      // which is the order they were sent in.
      for (let [index, { entry }] of writes.entries()) {
        results.set(
          entry.position,
          writeResult(committed[index], (url) =>
            this.#virtualNetwork.unresolveURL(url),
          ),
        );
      }
    }

    return this.#operationsResponse(
      { 'atomic:results': resultsTree(tree, results) },
      200,
      requestContext,
    );
  }

  // Which behavior one entry's name means for its target, labelled with the
  // entry's position.
  //
  // The name is resolved against the target's own definition, never read off
  // the wire — the envelope carries the operation's name, and what a `delete`
  // does is whatever the card's type says it does.
  async #resolveEnvelopeEntry(
    entry: EnvelopeEntry,
    scope: OperationScope,
  ): Promise<ResolvedEnvelopeEntry> {
    try {
      // Canonicalized once, here, and everything downstream sees the result:
      // the definition is resolved from it, the read runs against it, and the
      // staged entry writes it. A trailing slash, a query string and a
      // fragment all name the card they hang off, and the index is read by
      // exact URL — so resolving the raw spelling would report a declared
      // operation as unknown on a card whose type declares it, and would leave
      // the entry's result carrying an id no other surface spells that way.
      let target = canonicalizeTarget(
        this.operationCore,
        targetFor(entry, this.url),
      );
      let canonical =
        target.kind === 'instance' && target.url !== entry.href
          ? { ...entry, href: target.url }
          : entry;
      let definition = await resolveOperation(
        this.operationCore,
        target,
        canonical.name,
        scope,
      );
      assertTravelsInEnvelope(canonical, definition);
      return { entry: canonical, target, definition };
    } catch (err: unknown) {
      throw atEntry(err, entry.position);
    }
  }

  // A batch's answer is never HTTP-cached. It is not a resource with a
  // validator: the same request run twice writes twice, and a read entry's
  // document is served without the index-time validator the card+json `GET`
  // builds — so there is nothing here a conditional request could be answered
  // against, and no ETag is emitted for one to be compared with.
  #operationsResponse(
    body: unknown,
    status: number,
    requestContext: RequestContext,
  ): Response {
    return createResponse({
      body: JSON.stringify(body, null, 2),
      init: {
        status,
        headers: {
          'content-type': SupportedMimeType.BoxelOperations,
          'cache-control': 'no-store',
        },
      },
      requestContext,
    });
  }

  // we track our own writes so that we can eliminate echoes in the file watcher

  // Write a file whose content is described as an edit of its own bytes.
  //
  // Everything the byte path does per file it does too, in the same order —
  // the ceiling, the initiation event, the own-write tracking, the byte-cache
  // drop and the peer notification — with two differences, both of which
  // follow from never holding the content. The unchanged-bytes short circuit
  // is gone: telling whether the result matches what is on disk would mean
  // reading what is on disk, and an edit that adds items never matches it
  // anyway. And the fingerprint is assembled from bounded reads of the file
  // once it is written, rather than computed from bytes in hand; it is the
  // same value either way, which is what lets a version computed here validate
  // against one computed the other way.
  //
  // A splice edits a card, so it is held to the card ceiling — by the byte
  // length the description reports, which costs no read.
  async #writeSplicedUnlocked(
    path: LocalPath,
    content: SplicedSource,
  ): Promise<{
    result: { path: LocalPath; lastModified: number; contentHash: string };
    row: { path: LocalPath; contentHash?: string; contentSize?: number };
  }> {
    this.assertWriteSize(content, 'card', path);
    let url = this.paths.fileURL(path);
    this.sendIndexInitiationEvent(url.href);
    await this.trackOwnWrite(path);
    // The content is assembled beside the file before it is renamed onto it,
    // so a watching realm sees that file appear and vanish. Both are this
    // realm's own doing, so both are tracked — but tracking is keyed by what
    // the path holds when the key is seeded, and a file that does not exist
    // yet seeds `added` and `removed` while the assembly is also a write. What
    // holds regardless is that the path is ignored, so nothing the watcher
    // reports about it reaches the index.
    let staging = partialWritePath(path);
    await this.trackOwnWrite(staging);
    await this.trackOwnWrite(staging, { isDelete: true });
    let { lastModified } = await this.#adapter.writeSpliced(path, content);
    this.invalidateCache(path);
    await this.#notifyFileChange(path);
    let contentHash = await computeContentHashFromRanges(
      content.size,
      async (start, length) =>
        await readRangeBytes(this.#adapter, path, start, length),
    );
    return {
      result: { path, lastModified, contentHash },
      row: { path, contentHash, contentSize: content.size },
    };
  }

  private async trackOwnWrite(path: LocalPath, opts?: { isDelete: true }) {
    let type = opts?.isDelete
      ? 'removed'
      : (await this.#adapter.exists(path))
        ? 'updated'
        : 'added';
    let recentWritesKey = this.constructRecentWritesKey(type, path);
    this.#recentWrites.set(
      recentWritesKey,
      setTimeout(() => {
        this.#recentWrites.delete(recentWritesKey);
      }, 500) as unknown as number, // don't use NodeJS Timeout type
    );
  }

  private constructRecentWritesKey(operation: string, path: string) {
    return `${operation}-${JSON.stringify({ [operation]: path })}`;
  }

  private getTrackedWrite(
    data: FileWatcherEventContent,
  ): { isTracked: boolean; url: URL } | undefined {
    let file: string;
    let type: string | undefined;
    if ('updated' in data) {
      file = data.updated;
      type = 'updated';
    } else if ('added' in data) {
      file = data.added;
      type = 'added';
    } else if ('removed' in data) {
      file = data.removed;
      type = 'removed';
    } else {
      return;
    }
    let recentWritesKey = this.constructRecentWritesKey(type, file);
    let url = this.paths.fileURL(file);
    let timeout = this.#recentWrites.get(recentWritesKey);
    if (timeout) {
      // This is a best attempt to eliminate an echo here since it's unclear whether this update is one
      // that we wrote or one that was created outside of us
      clearTimeout(timeout);
      this.#recentWrites.delete(recentWritesKey);
      return { isTracked: true, url };
    }
    return { isTracked: false, url };
  }

  async delete(
    path: LocalPath,
    options?: { waitForIndex?: boolean; initiatingUser?: string | null },
  ): Promise<void> {
    await this.#dbAdapter.withFileWriteLocks(this.url, [path], () =>
      this._deleteUnlocked(path, options),
    );
  }

  private async _deleteUnlocked(
    path: LocalPath,
    options?: { waitForIndex?: boolean; initiatingUser?: string | null },
  ): Promise<void> {
    let url = this.paths.fileURL(path);
    this.sendIndexInitiationEvent(url.href);
    await this.trackOwnWrite(path, { isDelete: true });
    await this.#adapter.remove(path);
    this.broadcastRealmEvent({
      eventName: 'update',
      removed: [path],
      realmURL: this.url,
    });
    this.invalidateCache(path);
    await this.#notifyFileChange(path);
    // Remove file meta for this path
    await this.removeFileMeta([path]);
    let waitForIndex = options?.waitForIndex !== false;
    if (waitForIndex) {
      let { invalidations, generation, invalidatedTypes } =
        await this.updateIndexAndCollectInvalidations(
          [{ url, operation: 'delete' }],
          { initiatedBy: options?.initiatingUser ?? null },
        );
      this.broadcastIncrementalInvalidationEvent(invalidations, {
        generation,
        invalidatedTypes,
      });
    } else {
      // Mirrors the write() waitForIndex:false path: await the durable
      // enqueue so DB-side failures still bubble out, but fire-and-forget
      // the worker settle. The post-worker broadcast runs inside the
      // deferred lifecycle via onSettled so realm.incrementalIndexing()
      // doesn't resolve before the broadcast.
      let enqueueStart = Date.now();
      let { settled } = await this.enqueueIndexUpdateAndCollectInvalidations(
        [{ url, operation: 'delete' }],
        {
          initiatedBy: options?.initiatingUser ?? null,
          onSettled: (deferredInvalidations, meta) => {
            this.broadcastIncrementalInvalidationEvent(deferredInvalidations, {
              generation: meta.generation,
              invalidatedTypes: meta.invalidatedTypes,
            });
          },
        },
      );
      settled.then(
        () => {
          this.#log.info(
            `Deferred delete-indexing settled for ${url.href} in ${Date.now() - enqueueStart}ms`,
          );
        },
        (err: unknown) => {
          this.#log.error(
            `Deferred delete-indexing chain failed for ${url.href} after ${Date.now() - enqueueStart}ms: ${stringifyErrorForLog(err)}`,
          );
        },
      );
    }
  }

  async deleteAll(paths: LocalPath[]): Promise<void> {
    await this.#dbAdapter.withFileWriteLocks(this.url, paths, () =>
      this._deleteAllUnlocked(paths),
    );
  }

  private async _deleteAllUnlocked(paths: LocalPath[]): Promise<void> {
    let urls: URL[] = [];
    let trackPromises: Promise<void>[] = [];
    let removePromises: Promise<void>[] = [];

    for (let path of paths) {
      let url = this.paths.fileURL(path);
      urls.push(url);
      this.sendIndexInitiationEvent(url.href);
      trackPromises.push(this.trackOwnWrite(path, { isDelete: true }));
      removePromises.push(this.#adapter.remove(path));
      this.invalidateCache(path);
    }

    await Promise.all(trackPromises);
    await Promise.all(removePromises);
    await Promise.all(paths.map((path) => this.#notifyFileChange(path)));
    this.broadcastRealmEvent({
      eventName: 'update',
      removed: paths,
      realmURL: this.url,
    });
    // Remove file meta for all deleted paths
    await this.removeFileMeta(paths);
    let { invalidations, generation, invalidatedTypes } =
      await this.updateIndexAndCollectInvalidations(
        urls.map((url) => ({ url, operation: 'delete' as const })),
      );
    this.broadcastIncrementalInvalidationEvent(invalidations, {
      generation,
      invalidatedTypes,
    });
  }

  get realmIndexUpdater() {
    return this.#realmIndexUpdater;
  }

  get realmIndexQueryEngine() {
    return this.#realmIndexQueryEngine;
  }

  // The operation core, built from the realm's own collaborators. What it is
  // handed is deliberately narrow: the definition cache and the index query
  // engine, plus plain functions for the few resolutions that belong to the
  // realm's fetch layer. It gets no network capability and no
  // `VirtualNetwork` — that resolves author-controlled identifiers, and an
  // operation runs in a trusted context where nothing author-written should be
  // able to steer a lookup. So the realm absolutizes a code ref and
  // canonicalizes a document's ids on the core's behalf, and an operation
  // never resolves either itself.
  get operationCore(): OperationCore {
    if (!this.#operationCore) {
      this.#operationCore = {
        realmURL: this.url,
        definitionLookup: this.#definitionLookup,
        indexQueryEngine: this.#realmIndexQueryEngine,
        readFileAsText: async (localPath) =>
          (await this.readFileAsText(localPath))?.content,
        openStoredFile: (localPath) => this.#operationStoredFile(localPath),
        storedFileMeta: (localPath, file, opts) =>
          this.#operationStoredFileMeta(localPath, file, opts),
        isIgnored: (url) => this.isIgnored(url),
        fileMetaDocument: (localPath) =>
          this.#operationFileMetaDocument(localPath),
        resolveCodeRef: (codeRef, relativeTo) => {
          let absolute = codeRefWithAbsoluteIdentifier(
            codeRef,
            relativeTo,
            undefined,
            this.#virtualNetwork,
          );
          return isResolvedCodeRef(absolute) ? absolute : undefined;
        },
        fileDefCodeRef: (url) =>
          resolveFileDefCodeRef(url, this.#virtualNetwork),
        unresolveInstanceIds: (doc) => this.#serveInstanceIdsAsRRI(doc),
      };
    }
    return this.#operationCore;
  }

  // Who an operation dispatched from an HTTP request is running for. The actor
  // is the identity the realm authenticated, which is empty for an anonymous
  // caller — an operation that reads it has to treat "nobody" as a value
  // rather than assume one is always there. The client request id is the
  // caller's own handle on this request, echoed on the index event a write
  // produces so the client can tell its own event from anyone else's.
  #callerOf(
    request: Request,
    requestContext: RequestContext,
  ): { actor: string; clientRequestId: string } {
    return {
      actor: requestContext.authenticatedUser ?? '',
      clientRequestId: request.headers.get('X-Boxel-Client-Request-Id') ?? '',
    };
  }

  // The batch coordinator's collaborators, built the same way and for the same
  // reason as the operation core's: the write-side work an operation does is
  // handed down as bound functions, so no executor resolves an identifier,
  // opens a file, or reaches the network. The lock and the unlocked commit are
  // among them, which is what puts the coordinator in charge of taking the lock
  // once and keeps it out of the business of re-entering it.
  get batchCore(): BatchCore {
    if (!this.#batchCore) {
      this.#batchCore = {
        realmURL: this.url,
        withWriteLocks: (localPaths, fn) =>
          this.#dbAdapter.withFileWriteLocks(this.url, localPaths, fn),
        fileExists: (localPath) => this.#adapter.exists(localPath),
        readSourceFile: async (localPath) => {
          let file = await this.readFileAsText(localPath);
          return file
            ? { content: file.content, lastModified: file.lastModified }
            : undefined;
        },
        openSourceBytes: async (localPath) => {
          let file = await this.#adapter.openFile(localPath);
          if (!file) {
            return undefined;
          }
          // From the stat the adapter already performed. An adapter that
          // cannot say how large a file is without reading it cannot offer an
          // entry that edits one without reading it either, which is also why
          // the size is never recovered from `file.content` — the single-use
          // body this read leaves untouched.
          if (file.size === undefined) {
            return undefined;
          }
          return {
            size: file.size,
            read: (start, end) =>
              this.#adapter.readRange(localPath, start, end),
          };
        },
        // Classified exactly as `_batchWriteUnlocked` classifies the same
        // bytes when it writes them, so the ceiling a batch holds its staged
        // bytes to is the ceiling the commit will apply rather than a second
        // opinion about it.
        assertWriteSize: (localPath, content) =>
          this.assertWriteSize(
            content,
            writeSizeType(localPath, content),
            localPath,
          ),
        drainIndexing: async () => {
          await this.incrementalIndexing();
        },
        isIgnored: (url) => this.isIgnored(url),
        // Narrowed to the two documents a program reads values from, each
        // handed over whole. An error row is reported as no row: it describes
        // why the card could not be indexed rather than what it holds, so
        // there is nothing in it for a program to read.
        indexedCardValues: async (url) => {
          let row = await this.#realmIndexQueryEngine.instance(url);
          if (!row || row.type !== 'instance') {
            return undefined;
          }
          return {
            pristine: row.instance,
            searchDoc: row.searchDoc ?? undefined,
          };
        },
        commitUnlocked: (batch, options) =>
          this._commitBatchUnlocked(batch, options),
        serializeCard: (doc, relativeTo) =>
          this.fileSerialization(doc, relativeTo),
        codeRefKey: (codeRef, relativeTo) =>
          internalKeyFor(codeRef, relativeTo, this.#virtualNetwork),
        resolveModuleId: (moduleId, relativeTo) =>
          this.#virtualNetwork.resolveRRI(moduleId, rri(relativeTo)),
        // The same normalization `fileSerialization` applies to every link it
        // writes, reached from the one place that owns identifier resolution,
        // so a card's links are spelled the same however the write arrived.
        storedLink: (selfLink, relativeTo) =>
          storedRelationshipLink(
            selfLink,
            relativeTo,
            new URL(this.url),
            this.#virtualNetwork,
          ),
        // Its inverse, reached from the same place for the same reason: what a
        // stored link resolves to is identifier resolution, not URL math.
        resolvedLink: (selfLink, relativeTo) =>
          resolvedRelationshipLink(selfLink, relativeTo, this.#virtualNetwork),
        lookupDefinition: async (codeRef, relativeTo) => {
          let absolute = codeRefWithAbsoluteIdentifier(
            codeRef,
            relativeTo,
            undefined,
            this.#virtualNetwork,
          );
          if (!isResolvedCodeRef(absolute)) {
            return undefined;
          }
          return await this.#definitionLookup.lookupDefinition(absolute);
        },
        // The same parse every card response reads its realm info from, minus
        // the half that response carries. An executor never opens the realm's
        // config document itself, for the reason it opens nothing else.
        realmConfig: () => this.getRealmConfig(),
      };
    }
    return this.#batchCore;
  }

  async reindex() {
    let { completed } = this.startReindex();
    await completed;
  }

  async #startup(opts?: { fromScratchIndexPriority?: number }) {
    await Promise.resolve();
    let startTime = Date.now();
    if (this.#copiedFromRealm) {
      let { generation } = await this.#realmIndexUpdater.copy(
        this.#copiedFromRealm,
      );
      this.broadcastRealmEvent({
        eventName: 'index',
        indexType: 'copy',
        sourceRealmURL: this.#copiedFromRealm.href,
        ...(generation !== undefined ? { generation } : {}),
        realmURL: this.url,
      });
    } else {
      let isNewIndex = await this.#realmIndexUpdater.isNewIndex();
      if (this.#skipBootIndex) {
        // Mount-and-serve only: no from-scratch index, even on a new index.
        // Definitions resolve lazily via the prerenderer on first lookup.
      } else if (isNewIndex || this.#fullIndexOnStartup) {
        if (this.#fullIndexOnStartup) {
          // CS-11245: bootstrap realms (kind='bootstrap': base,
          // catalog, skills, …) full-index on every realm-server
          // boot. On a rolling deploy the worker that picks up the
          // resulting from-scratch-index job fans HTTP source reads
          // through the LB, which can route to a still-warm
          // pre-deploy peer whose `#sourceCache` was populated from
          // pre-rsync bytes. `getSourceOrRedirect` would return those
          // stale bytes and the reindex would persist them into
          // `boxel_index.pristine_doc` plus sticky `error_doc` rows
          // that survive past fleet stabilization (see CS-11245 for
          // the originating incident). Broadcast a per-realm
          // NOTIFY so every peer drops its entries for this URL and
          // the next read falls through to `/persistent/` (EFS,
          // already brought up to date by this container's
          // `setup:<realm>-in-deployment` rsync at PID 1). The local
          // clear is a no-op on a freshly booted container; the
          // broadcast is what does the work. Skipped on the
          // `isNewIndex` branch — that branch fires for first-ever
          // mounts (e.g., brand-new publish), where peer caches for
          // a never-before-seen URL are empty by construction.
          await this.clearLocalSourceCachesAndBroadcast();
        }
        let priority =
          opts?.fromScratchIndexPriority ?? this.#fromScratchIndexPriority;
        let promise = this.#realmIndexUpdater.fullIndex(priority);
        if (isNewIndex) {
          // we only await the full indexing at boot if this is a brand new index
          await promise;
        }
        // not sure how useful this event is--nothing is currently listening for
        // it, and it may happen during or after the full index...
        this.broadcastRealmEvent({
          eventName: 'index',
          indexType: 'full',
          realmURL: this.url,
        });
      }
    }

    this.#perfLog.debug(
      `realm server ${this.url} startup in ${Date.now() - startTime} ms`,
    );
  }

  // TODO get rid of this
  maybeHandle = async (
    request: Request,
  ): Promise<ResponseWithNodeStream | null> => {
    if (!this.paths.inRealm(rri(request.url))) {
      return null;
    }
    return await this.internalHandle(request, true);
  };

  handle = async (request: Request): Promise<ResponseWithNodeStream | null> => {
    if (!this.paths.inRealm(rri(request.url))) {
      return null;
    }
    return await this.internalHandle(request, false);
  };

  async getRealmOwnerUserId(): Promise<string> {
    let permissions = await fetchRealmPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );

    let userIds = Object.entries(permissions)
      .filter(([_, realmActions]) => realmActions.includes('realm-owner'))
      .map(([userId]) => userId);
    if (userIds.length > 1) {
      // we want to use the realm's human owner for the realm and not the bot
      userIds = userIds.filter((userId) => !userId.startsWith('@realm/'));
    }

    let [userId] = userIds;
    // real matrix user ID's always start with an '@', if it doesn't that
    // means we are testing
    if (userId?.startsWith('@')) {
      return userId;
    }
    // hard coded test URLs

    // TODO::`( this should be removed.
    if ((globalThis as any).__environment === 'test') {
      let url = new URL(this.url);
      if (url.hostname === '127.0.0.1') {
        switch (url.port) {
          case '4441':
            return '@base_realm:localhost';
          case '4444':
          case '4445':
          case '4446':
          case '4447':
          case '4448':
          case '4449':
          case '4450':
          case '4451':
          case '4452':
            return '@node-test_realm:localhost';
        }
      }
      return '@test_realm:localhost';
    }
    throw new Error(`Cannot determine realm owner for realm ${this.url}.`);
  }

  async getRealmOwnerUsername(): Promise<string> {
    let userId = await this.getRealmOwnerUserId();
    return getMatrixUsername(userId);
  }

  private async createSession(
    request: Request,
    requestContext: RequestContext,
  ) {
    let matrixBackendAuthentication = new MatrixBackendAuthentication(
      this.#matrixClient,
      {
        badRequest: function (message: string) {
          return badRequest({ message, requestContext });
        },
        createResponse: function (
          body: BodyInit | null,
          init: ResponseInit | undefined,
        ) {
          return createResponse({
            body,
            init,
            requestContext,
          });
        },
        createJWT: async (user: string, sessionRoom: string) => {
          let permissions = requestContext.permissions;

          let userPermissions = await new RealmPermissionChecker(
            permissions,
            this.#matrixClient,
          ).for(user);
          return this.#adapter.createJWT(
            {
              user,
              sessionRoom,
              permissions: userPermissions,
              realm: this.url,
              realmServerURL: this.#realmServerURL,
            },
            SESSION_TOKEN_TTL,
            this.#realmSecretSeed,
          );
        },
        ensureSessionRoom: async (userId: string) =>
          this.ensureSessionRoom(userId),
      } as Utils,
    );

    return await matrixBackendAuthentication.createSession(request);
  }

  private async internalHandle(
    request: Request,
    isLocal: boolean,
  ): Promise<ResponseWithNodeStream> {
    let redirectResponse = this.rootRealmRedirect(request);
    if (redirectResponse) {
      return redirectResponse;
    }

    if (
      request.method === 'POST' &&
      request.headers.get('X-HTTP-Method-Override') === 'QUERY'
    ) {
      request = new Request(request.url, {
        method: 'QUERY',
        headers: request.headers,
        body: await request.clone().text(),
      });
      request.headers.delete('X-HTTP-Method-Override');
    }

    let localPath = this.paths.local(new URL(request.url));
    let requiredPermission: RealmAction = 'read';
    if (localPath === '_permissions') {
      requiredPermission = 'realm-owner';
    } else if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method)) {
      requiredPermission = 'write';
    }

    let requestContext = await this.createRequestContext(requiredPermission);

    try {
      if (!isLocal) {
        // A capture-URL token (`?token=` on a `_screenshot/` GET) authorizes
        // exactly this request without an Authorization header — the door for
        // fetches the host's auth service worker cannot reach (`<object>`/
        // `<embed>` loads, top-level navigations). A missing or failing token
        // falls through to the normal permission check, so a public realm
        // still serves and a private realm still 401s the usual way.
        let captureTokenUser =
          request.method === 'GET' && isCaptureServingPath(localPath)
            ? await this.verifyCaptureURLToken(
                request,
                localPath,
                requestContext,
              )
            : undefined;
        if (captureTokenUser !== undefined) {
          requestContext.authenticatedUser = captureTokenUser;
        } else {
          await this.checkPermission(
            request,
            requestContext,
            requiredPermission,
          );
        }
        // An archived realm is sealed for everyone, owner included: once a
        // caller is authorized, every external content request is
        // short-circuited with 403 (archived). The seal runs AFTER
        // checkPermission so an unauthenticated or unauthorized caller to a
        // private realm gets the normal 401/403 and never learns the realm
        // exists or is archived — only callers who could otherwise reach the
        // content see the sealed response. A public realm's readers are
        // authorized by checkPermission, so they do see the seal (the realm's
        // existence is already public). The seal is method-agnostic, so reads
        // and writes are blocked by this one check. The realm's public
        // operational endpoints stay reachable while archived: the
        // `_readiness-check` health probe (so health checks don't read an
        // archived realm as down) and `_session` (so authentication still
        // works). They're matched on `localPath`, independent of request
        // headers, so a bare health probe that sends no `Accept` header is
        // still exempt. The archive-management endpoints live on the realm
        // SERVER router and never reach this boundary, so they stay reachable.
        // Read fresh (no memoization) for the same reason createRequestContext
        // does: a peer replica's archive/unarchive must take effect here
        // without a restart.
        if (
          !ARCHIVED_SEAL_EXEMPT_PATHS.has(localPath) &&
          (await isRealmArchived(this.#dbAdapter, new URL(this.url)))
        ) {
          throw new ArchivedRealmError(`Realm ${this.url} is archived`);
        }
      }
      if (!this.#realmIndexQueryEngine) {
        return systemError({
          requestContext,
          message: 'search index is not available',
        });
      }
      // Screenshot serving dispatches on the path prefix, not the router
      // table: the router keys routes on the Accept header, and the browser
      // requests this route must serve (`<img>` loads, og:image fetches)
      // send `image/*`-shaped Accept values that match no supported mime
      // type. Placed after checkPermission so the route inherits realm-read
      // auth exactly like any realm resource. GET only — checkPermission
      // exempts HEAD from auth realm-wide, so admitting HEAD here would
      // hand unauthenticated callers an existence/size/content-hash oracle
      // over a private realm's captures; no consumer of this route (image
      // loads, crawlers) sends HEAD.
      if (request.method === 'GET' && isCaptureServingPath(localPath)) {
        return await this.serveScreenshot(
          request,
          requestContext,
          localPath.slice(CAPTURE_SERVING_PREFIX.length),
        );
      }
      // Hashed scoped-CSS serving also dispatches on the path rather than
      // the router table: the request is a module load (`loader.import` of a
      // `css` resource's href from search results), whose Accept header
      // matches no supported mime type. The URL carries only a content hash —
      // the stylesheet bytes live in the `scoped_css` table — so unlike the
      // inline form (which `maybeHandleScopedCSSRequest` answers locally with
      // no network hop) this form must be answered here. Gated on the
      // `_scoped-css/` prefix, not just the filename shape, so a realm file
      // whose path merely looks hashed isn't shadowed — `scopedCSSServingHref`
      // is the only producer of these hrefs and always roots them under the
      // prefix. Placed after checkPermission so it inherits realm-read auth;
      // GET only for the same HEAD-oracle reason as screenshot serving above.
      if (
        request.method === 'GET' &&
        localPath.startsWith(SCOPED_CSS_SERVING_PREFIX) &&
        isHashedScopedCSSRequest(localPath)
      ) {
        return await this.serveHashedScopedCSS(request, requestContext);
      }
      // A file the realm is part-way through assembling, or one a write that
      // died left behind. It is never indexed, so serving it would hand back
      // content the realm does not otherwise acknowledge exists.
      if (isPartialWritePath(localPath)) {
        return notFound(request, requestContext);
      }
      // The GET dispatch above claims the whole `_screenshot/` subtree, so a
      // realm file stored under it could never be read back — it would
      // index, list, and answer every GET as an uncaptured miss. Refuse
      // creation writes up front so the collision surfaces at write time
      // (the `/_atomic` precheck enforces the same reservation for its
      // operation hrefs). DELETE stays admitted as the recovery path for
      // anything already stored there.
      let reserved = ['PUT', 'PATCH', 'POST'].includes(request.method)
        ? reservedWriteDestination(localPath)
        : undefined;
      if (reserved) {
        return badRequest({ message: reserved, requestContext });
      }
      if (this.#router.handles(request)) {
        return this.#router.handle(request, requestContext);
      } else {
        return this.fallbackHandle(request, requestContext);
      }
    } catch (e) {
      if (e instanceof AuthenticationError) {
        return createResponse({
          body: e.message,
          init: {
            status: 401,
            headers: {
              'X-Boxel-Realm-Url': requestContext.realm.url,
            },
          },
          requestContext,
        });
      }

      if (e instanceof ArchivedRealmError) {
        // 403 (not 404) carrying an "archived" marker — both a dedicated
        // header and a JSON:API error with a stable `code` — so the client can
        // distinguish a sealed realm from a generic forbidden response and
        // render the right message.
        return createResponse({
          body: JSON.stringify({
            errors: [
              {
                status: '403',
                code: 'archived',
                title: 'Realm Archived',
                detail: e.message,
              },
            ],
          }),
          init: {
            status: 403,
            headers: {
              'content-type': SupportedMimeType.JSONAPI,
              'X-Boxel-Realm-Archived': 'true',
              'X-Boxel-Realm-Url': requestContext.realm.url,
            },
          },
          requestContext,
        });
      }

      if (e instanceof AuthorizationError) {
        return new Response(`${e.message}`, {
          status: 403,
        });
      }

      throw e;
    }
  }

  // Requests for the root of the realm without a trailing slash aren't
  // technically inside the realm (as the realm includes the trailing '/'),
  // so issue a redirect in those scenarios.
  private rootRealmRedirect(request: Request) {
    let url = new URL(request.url);
    let urlWithoutQueryParams = url.protocol + '//' + url.host + url.pathname;
    if (`${urlWithoutQueryParams}/` === this.url) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: String(url.searchParams)
            ? `${this.url}?${url.searchParams}`
            : this.url,
        },
      });
    }
    return undefined;
  }

  private async fallbackHandle(
    request: Request,
    requestContext: RequestContext,
  ) {
    let start = Date.now();
    let url = new URL(request.url);
    let localPath = this.paths.local(url);
    let moduleCachingDisabled =
      this.#disableModuleCaching ||
      Boolean(request.headers.get('X-Boxel-Disable-Module-Cache'));

    if (!moduleCachingDisabled) {
      // Answered from memory: these bytes were compiled from a read that
      // already happened, so nothing here reaches a file and no `readSource`
      // is dispatched for this request. Worth knowing wherever something is
      // hung on that dispatch — this return point sits in front of it, not
      // behind it.
      let cached = this.#transpiledModuleCache.get(localPath);
      if (cached) {
        try {
          let etag = cached.headers.etag;
          if (etag && request.headers.get('if-none-match') === etag) {
            let headers: Record<string, string> = {
              [CACHE_HEADER]: CACHE_HIT_VALUE,
            };
            for (let [key, value] of Object.entries(cached.headers)) {
              if (key.toLowerCase() === 'content-type') {
                continue;
              }
              headers[key] = value;
            }
            return createResponse({
              body: null,
              init: {
                status: 304,
                headers,
              },
              requestContext,
            });
          }

          return createResponse({
            body: cached.body,
            init: {
              status: 200,
              headers: {
                ...cached.headers,
                [CACHE_HEADER]: CACHE_HIT_VALUE,
              },
            },
            requestContext,
          });
        } finally {
          this.#logRequestPerformance(request, start, 'cache hit');
        }
      }
    }

    // CS-11028: snapshot module-cache generations BEFORE the first await
    // for every candidate path getFileWithFallbacks could resolve to
    // (localPath plus each executable-extension fallback when the
    // request is extensionless). invalidateCache(path) bumps the
    // counter synchronously, so if it fires while loadModuleFromDisk
    // is in-flight (typically 50–500 ms for a .gts transpile) the
    // post-await comparison against result.canonicalPath's snapshotted
    // gen catches the race and we skip the cache write — otherwise the
    // pre-invalidation bytes we just produced would re-fill the slot
    // invalidate just cleared. Checking by canonicalPath rather than
    // localPath is what makes the discard work for extensionless alias
    // requests (e.g. /foo → loadModuleFromDisk returns foo.gts);
    // invalidateCache targets the canonical, so the gen we need to
    // compare against is the canonical's. We still serve our own
    // response: it reflects the source A read at request time, which
    // is consistent with the caller's happens-before ordering.
    let cacheGenSnapshot = moduleCachingDisabled
      ? undefined
      : this.#snapshotModuleCacheGeneration(localPath);

    let response: ResponseWithNodeStream;
    try {
      let result = await this.loadModuleFromDisk(
        localPath,
        request,
        requestContext,
      );
      switch (result.kind) {
        case 'module': {
          if (
            !moduleCachingDisabled &&
            cacheGenSnapshot &&
            !this.#transpiledModuleCacheGenerationChanged(
              result.canonicalPath,
              cacheGenSnapshot,
            )
          ) {
            this.#transpiledModuleCache.set(localPath, {
              canonicalPath: result.canonicalPath,
              body: result.body,
              headers: result.headers,
              dependencyKeys: result.dependencyKeys,
            });
          }
          response = createResponse({
            body: result.body,
            init: {
              status: 200,
              headers: {
                ...result.headers,
                [CACHE_HEADER]: CACHE_MISS_VALUE,
              },
            },
            requestContext,
          });
          break;
        }
        case 'not-modified': {
          response = createResponse({
            body: null,
            init: {
              status: 304,
              headers: {
                ...result.headers,
                [CACHE_HEADER]: CACHE_MISS_VALUE,
              },
            },
            requestContext,
          });
          break;
        }
        case 'not-found':
        case 'non-module':
        case 'shimmed': {
          response = result.response;
          break;
        }
      }
    } catch (err) {
      this.#logRequestPerformance(request, start, 'cache miss');
      return this.moduleErrorResponse(url.href, err, requestContext);
    }

    this.#logRequestPerformance(request, start, 'cache miss');
    return response;
  }
  private async loadModuleFromDisk(
    localPath: LocalPath,
    request: Request,
    requestContext: RequestContext,
  ): Promise<ModuleLoadResult> {
    let maybeFileRef = await this.getFileWithFallbacks(
      localPath,
      executableExtensions,
    );
    if (!maybeFileRef) {
      return {
        kind: 'not-found',
        response: notFound(
          request,
          requestContext,
          `${this.#virtualNetwork.unresolveURL(request.url)} not found`,
        ),
      };
    }

    let fileRef = maybeFileRef;
    let canonicalPath = this.paths.fileURL(fileRef.path).href;
    if (!hasExecutableExtension(fileRef.path)) {
      // A path that holds bytes rather than a module: an image, a PDF, a
      // markdown document. Its bytes are the `readSource` operation's, the
      // same read the `card+source` route makes of the same file — which is
      // what makes "every read of this path" one thing however a client asked
      // for it.
      //
      // The module serve below reads its source the same way and compiles
      // what comes back. What the two paths do not share is the caches around
      // that compile: a module answered from one of them is answered without
      // any read at all.
      let source = await this.#readStoredSource(
        this.#callerOf(request, requestContext),
        fileRef.path,
        // Nothing here holds on to the bytes, so a `HEAD` asks only for what
        // its headers are computed from.
        { headersOnly: request.method === 'HEAD' ? true : undefined },
      );
      if (!source) {
        return {
          kind: 'not-found',
          response: notFound(
            request,
            requestContext,
            `${this.#virtualNetwork.unresolveURL(request.url)} not found`,
          ),
        };
      }
      return {
        kind: 'non-module',
        response: await this.serveLocalFile(
          request,
          this.#servableSource(fileRef, source),
          requestContext,
          {
            defaultHeaders: {
              'content-type': source.contentType,
            },
            createdAt: source.created,
          },
        ),
      };
    }

    if (fileRef[Symbol.for('shimmed-module')]) {
      let response = createResponse({
        requestContext,
        init: {
          headers: {
            'X-Boxel-Canonical-Path': canonicalPath,
          },
        },
      }) as ResponseWithNodeStream;
      (response as any)[Symbol.for('shimmed-module')] =
        fileRef[Symbol.for('shimmed-module')];
      return { kind: 'shimmed', response };
    }

    let etag = buildEtag(fileRef.lastModified, MODULE_ETAG_VARIANT);
    if (etag && request.headers.get('if-none-match') === etag) {
      let headers: Record<string, string> = {
        'cache-control': 'public, max-age=0',
      };
      headers.etag = etag;
      if (fileRef.lastModified != null) {
        headers['last-modified'] = formatRFC7231(fileRef.lastModified * 1000);
      }
      headers['X-Boxel-Canonical-Path'] = canonicalPath;
      return {
        kind: 'not-modified',
        canonicalPath: fileRef.path,
        headers,
      };
    }

    return this.#transpileModuleDeduped(
      localPath,
      fileRef,
      etag,
      this.#callerOf(request, requestContext),
    );
  }

  // Dedups the materialize + transpile pipeline across concurrent
  // same-path callers (CS-11029). The first caller installs a pending
  // promise keyed by localPath; any caller that arrives while it's
  // in-flight returns the same promise instead of running babel a
  // second time. Identity-checked cleanup on settle mirrors
  // CachingDefinitionLookup.#inFlight — a newer pending entry installed
  // after invalidateCache drops the slot is preserved when the older
  // promise eventually settles.
  //
  // The source read those bytes are compiled from is dispatched for the
  // caller that started the work, so a joiner is served bytes read on someone
  // else's behalf. That is what one compile per path means once the read
  // inside it is an operation with a caller attached.
  //
  // The cross-process coalesce below shares work the same way where it can —
  // the winner reads, the losers take its row — but a loser that wakes to no
  // row compiles for itself, under its own caller. So a path's read is one
  // read per compile, not one per path: whichever callers end up compiling
  // each read as themselves.
  async #transpileModuleDeduped(
    localPath: LocalPath,
    fileRef: FileRef,
    etag: string | undefined,
    caller: OperationCaller,
  ): Promise<ModuleTranspileResult> {
    let existing = this.#inFlightTranspiles.get(localPath);
    if (existing) {
      this.#transpileJoinCount += 1;
      return existing;
    }
    // Assign the chained `.finally` to `pending` and store/return THAT
    // (not the raw layered promise). If we kept the raw promise in the
    // map and dangled an unused `.finally(...)` chain, a rejection from
    // transpileJS would propagate through both promises but only the
    // raw one has waiters — the chained one would surface as an
    // unhandled rejection in Node's host hook. Same shape as
    // CachingDefinitionLookup.#inFlight.
    let pending: Promise<ModuleTranspileResult>;
    let core = this.#transpileWithLayers(fileRef, etag, caller);
    pending = core.finally(() => {
      if (this.#inFlightTranspiles.get(localPath) === pending) {
        this.#inFlightTranspiles.delete(localPath);
      }
    });
    this.#inFlightTranspiles.set(localPath, pending);
    return pending;
  }

  // CS-11030: orchestrates the cache layers below the in-process inflight
  // dedup. Layering:
  //   1. read module_transpile_cache — a peer (or this process on a
  //      prior request that fell out of the in-memory cache) may have
  //      already produced the bytes; just return them.
  //   2. (with coordinator) tryAcquireAndRun: winner re-reads the DB,
  //      transpiles on miss, persists to module_transpile_cache, and
  //      emits NOTIFY before commit; losers waitForKey + re-read.
  //   3. (no coordinator, or loser fell through) run #materializeAndTranspile
  //      directly. The L2 DB write still happens — sqlite deployments
  //      simply skip the cross-process coalesce.
  //
  // The L2 write uses an OCC pattern: the writer captures the row's
  // `generation` at the L2 read step (or 0 if the row is absent) and
  // UPSERTs with that captured value via `ON CONFLICT DO UPDATE
  // WHERE existing.generation <= captured`. An invalidate that lands
  // during the transpile bumps the row's generation past the captured
  // value, so the writer's UPSERT is rejected by the WHERE clause and
  // a stale transpile started before the invalidate cannot resurrect
  // the row. Mirrors CS-11028's L1 generation guard but with a durable
  // counter visible to every peer.
  async #transpileWithLayers(
    fileRef: FileRef,
    etag: string | undefined,
    caller: OperationCaller,
  ): Promise<ModuleTranspileResult> {
    let canonicalPath = this.paths.fileURL(fileRef.path).href;
    let coordinator = this.#transpileCoordinator;

    // L2 read first — cheap query (UNLOGGED, indexed PK), saves babel.
    // Answered from the shared cache: like the in-memory one, this return
    // point serves bytes some earlier compile read, so no `readSource` is
    // dispatched for the request that reaches it. The same holds for the two
    // other returns of a cached row below.
    let cached = await this.#readTranspileCacheRow(canonicalPath);
    if (cached?.result) {
      return cached.result;
    }
    // capturedGeneration is the row's generation observed at this
    // point in time — 0 if the row was absent, the tombstone's
    // generation otherwise. The L2 write uses this value as its OCC
    // token: any invalidate that races the transpile bumps generation
    // past `capturedGeneration`, so the write's WHERE clause rejects
    // the UPSERT.
    let capturedGeneration = cached?.generation ?? 0;

    if (!coordinator) {
      let result = await this.#materializeAndTranspile(fileRef, etag, caller);
      await this.#writeTranspileCacheRow(
        canonicalPath,
        result,
        capturedGeneration,
      );
      return result;
    }

    let coalesceKey = `transpile|${this.url}|${canonicalPath}`;
    let attempt = await coordinator.tryAcquireAndRun(
      coalesceKey,
      async (querier) => {
        // Winner path: a peer may have written between our miss and our
        // lock acquisition; re-read so we don't redo their work AND
        // refresh our captured generation in case a tombstone landed.
        // Run the re-read and the persist on the coordinator's pinned
        // querier so this whole coordinated transpile holds exactly one
        // pool connection — the lock connection — rather than pinning it
        // and then checking out more for these queries.
        let recheck = await this.#readTranspileCacheRow(canonicalPath, querier);
        if (recheck?.result) {
          return recheck.result;
        }
        let result = await this.#materializeAndTranspile(fileRef, etag, caller);
        await this.#writeTranspileCacheRow(
          canonicalPath,
          result,
          recheck?.generation ?? 0,
          querier,
        );
        return result;
      },
    );
    if (attempt.acquired) {
      return attempt.result;
    }

    // Loser path: park on NOTIFY (resolves on either the populate
    // signal or a bounded timeout — see CachingDefinitionLookup's
    // COALESCE_NOTIFY_WAIT_MS for the rationale on the budget). On
    // wake, re-read; the row should be there if the winner succeeded.
    await coordinator.waitForKey(coalesceKey, COALESCE_NOTIFY_WAIT_MS);
    let postWait = await this.#readTranspileCacheRow(canonicalPath);
    if (postWait?.result) {
      return postWait.result;
    }
    // Missed NOTIFY, peer crashed, or the winner skipped persist (e.g.
    // a generation discard upstream). Fall through to a local transpile;
    // we still persist so the NEXT reader sees a cached row. Use the
    // freshest generation we've observed for the OCC token.
    let result = await this.#materializeAndTranspile(fileRef, etag, caller);
    await this.#writeTranspileCacheRow(
      canonicalPath,
      result,
      postWait?.generation ?? 0,
    );
    return result;
  }

  async #readTranspileCacheRow(
    canonicalPath: string,
    // When provided (winner path), reads run on the coordinator's pinned
    // lock connection; otherwise they fall back to the shared pool.
    querier?: Querier,
  ): Promise<
    | {
        result?: ModuleTranspileResult;
        generation: number;
      }
    | undefined
  > {
    let runQuery = querier ?? dbAdapterQuerier(this.#dbAdapter);
    let rows = (await runQuery([
      'SELECT body, headers, dependency_keys, generation',
      'FROM',
      MODULE_TRANSPILE_CACHE_TABLE,
      'WHERE realm_url =',
      param(this.url),
      'AND canonical_path =',
      param(canonicalPath),
    ])) as {
      body: string | null;
      headers: Record<string, string> | string | null;
      dependency_keys: string[] | string | null;
      generation: string | number;
    }[];
    if (!rows.length) {
      return undefined;
    }
    let row = rows[0];
    let generation =
      typeof row.generation === 'string'
        ? Number(row.generation)
        : row.generation;
    if (row.body == null || row.headers == null) {
      // Tombstone — surface only the generation so the writer can
      // capture it for OCC.
      return { generation };
    }
    let headers =
      typeof row.headers === 'string'
        ? (JSON.parse(row.headers) as Record<string, string>)
        : row.headers;
    let canonicalFromHeader = headers['X-Boxel-Canonical-Path'];
    // canonical_path stores the realm-relative + extension form
    // matching fileRef.path; the header carries the full URL.
    // Either is sufficient to reconstruct the result, but the
    // header is what the response uses, so prefer that and parse
    // back to the local path for the returned `canonicalPath`.
    let pathFromHeader: string | undefined = undefined;
    if (canonicalFromHeader) {
      try {
        pathFromHeader = this.paths.local(new URL(canonicalFromHeader));
      } catch {
        // ignore
      }
    }
    let canonicalPathLocal =
      pathFromHeader ?? this.paths.local(new URL(canonicalPath));
    let depsArray =
      typeof row.dependency_keys === 'string'
        ? (JSON.parse(row.dependency_keys) as string[])
        : (row.dependency_keys ?? []);
    // Carry the writer's deps through. The writer always persists the
    // full set computed from the transpiled body, so an empty array
    // legitimately means the module has no in-realm imports. A row
    // written before deps were carried (rollout window) will also read
    // as empty here — its L1 entry will be missing dep edges until the
    // next invalidate forces a re-transpile. The table is UNLOGGED, so
    // pre-rollout rows age out on any pg restart.
    let dependencyKeys = new Set<string>(depsArray);
    return {
      result: {
        kind: 'module',
        canonicalPath: canonicalPathLocal,
        body: row.body,
        headers,
        dependencyKeys,
      },
      generation,
    };
  }

  async #writeTranspileCacheRow(
    canonicalPath: string,
    result: ModuleTranspileResult,
    capturedGeneration: number,
    // When provided (winner path), the UPSERT runs on the coordinator's
    // pinned lock connection — so it commits with the lock + NOTIFY and
    // doesn't check out a second pool client. Otherwise it falls back to
    // the shared pool, autocommitting on its own connection.
    querier?: Querier,
  ): Promise<void> {
    let runQuery = querier ?? dbAdapterQuerier(this.#dbAdapter);
    // On the pinned-querier path this UPSERT runs inside the
    // coordinator's lock transaction. L2 persistence is best-effort, but
    // a pg error here would abort that transaction and break the
    // coordinator's following pg_notify + COMMIT — failing a request that
    // could otherwise serve the already-transpiled bytes. Wrap the write
    // in a savepoint so a failure rolls back just this statement and
    // leaves the enclosing transaction usable. On the shared adapter each
    // query autocommits on its own connection, so no savepoint is needed.
    let inLockTransaction = querier != null;
    const savepoint = 'transpile_cache_write';
    try {
      if (inLockTransaction) {
        await runQuery([`SAVEPOINT ${savepoint}`]);
      }
      // INSERT a row at `capturedGeneration`. On conflict, UPDATE only
      // if the row's current generation is still <= capturedGeneration.
      // If an invalidate has tombstoned-and-bumped the row past that
      // value, the WHERE clause rejects the UPDATE and the stale
      // transpile is discarded. capturedGeneration may legitimately be
      // 0 (row absent at read time, tombstone never created) — in
      // that case the WHERE 0 <= 0 still allows a no-op same-gen
      // overwrite which is benign because the bytes are deterministic
      // for the same source.
      await runQuery([
        'INSERT INTO',
        MODULE_TRANSPILE_CACHE_TABLE,
        '(realm_url, canonical_path, body, headers, dependency_keys, generation, created_at)',
        'VALUES (',
        param(this.url),
        ',',
        param(canonicalPath),
        ',',
        param(result.body),
        ',',
        param(JSON.stringify(result.headers)),
        dbExpression({ pg: '::jsonb' }),
        ',',
        // Persist the full deps set computed once at the transpile
        // boundary so a cross-process L2 reader can populate its L1
        // entry directly instead of re-running extractModuleDependencyKeys
        // on the bytes.
        param(JSON.stringify([...result.dependencyKeys])),
        dbExpression({ pg: '::jsonb' }),
        ',',
        param(capturedGeneration),
        ',',
        param(Date.now()),
        ') ON CONFLICT (realm_url, canonical_path) DO UPDATE SET',
        'body = EXCLUDED.body,',
        'headers = EXCLUDED.headers,',
        'dependency_keys = EXCLUDED.dependency_keys,',
        'generation = EXCLUDED.generation,',
        'created_at = EXCLUDED.created_at',
        `WHERE ${MODULE_TRANSPILE_CACHE_TABLE}.generation <= EXCLUDED.generation`,
      ]);
      if (inLockTransaction) {
        await runQuery([`RELEASE SAVEPOINT ${savepoint}`]);
      }
    } catch (err: unknown) {
      // L2 persistence is best-effort. A transient pg failure must not
      // break the response the caller is about to serve — they already
      // have the bytes in memory. Log and move on; the next reader will
      // re-try the write.
      if (inLockTransaction) {
        // Roll back just the failed write so the coordinator's enclosing
        // lock transaction stays usable for its pg_notify + COMMIT.
        try {
          await runQuery([`ROLLBACK TO SAVEPOINT ${savepoint}`]);
        } catch (rollbackErr: unknown) {
          this.#log.warn(
            `ROLLBACK TO SAVEPOINT after ${MODULE_TRANSPILE_CACHE_TABLE} write failure failed for ${this.url}${canonicalPath}: ${String(rollbackErr)}`,
          );
        }
      }
      this.#log.warn(
        `${MODULE_TRANSPILE_CACHE_TABLE} insert failed for ${this.url}${canonicalPath}: ${String(err)}`,
      );
    }
  }

  // Test seam: lets host SQLite tests verify that #writeTranspileCacheRow
  // produces dialect-correct SQL without re-issuing the UPSERT in a
  // parallel build. Production code must never call this — go through
  // the private method directly. The wrapper just forwards arguments;
  // the swallow-and-log behavior of the private method means the test
  // confirms success by reading the row back, not by exception.
  async __testOnlyUpsertTranspileCacheRow(args: {
    canonicalPath: string;
    body: string;
    headers: Record<string, string>;
    dependencyKeys: Iterable<string>;
    capturedGeneration: number;
  }): Promise<void> {
    let { canonicalPath, body, headers, dependencyKeys, capturedGeneration } =
      args;
    await this.#writeTranspileCacheRow(
      canonicalPath,
      {
        kind: 'module',
        canonicalPath,
        body,
        headers,
        dependencyKeys: new Set(dependencyKeys),
      },
      capturedGeneration,
    );
  }

  async #deleteTranspileCacheRow(canonicalPath: string): Promise<void> {
    try {
      // Tombstone-and-bump rather than physically DELETE: an in-flight
      // writer that captured this path's generation BEFORE the
      // invalidate needs to observe the bumped generation when it
      // tries to UPSERT, so its WHERE existing.generation <= captured
      // clause fails and the stale bytes are rejected. A physical
      // DELETE would let the writer's INSERT succeed (no conflict, no
      // row to compare against) and resurrect the stale transpile.
      await query(this.#dbAdapter, [
        'INSERT INTO',
        MODULE_TRANSPILE_CACHE_TABLE,
        '(realm_url, canonical_path, body, headers, dependency_keys, generation, created_at)',
        'VALUES (',
        param(this.url),
        ',',
        param(canonicalPath),
        ',',
        'NULL, NULL, NULL, 1,',
        param(Date.now()),
        ') ON CONFLICT (realm_url, canonical_path) DO UPDATE SET',
        'body = NULL,',
        'headers = NULL,',
        'dependency_keys = NULL,',
        `generation = ${MODULE_TRANSPILE_CACHE_TABLE}.generation + 1,`,
        'created_at = EXCLUDED.created_at',
      ]);
    } catch (err: unknown) {
      // Same best-effort posture as #writeTranspileCacheRow — the in-memory
      // L1 cache for this path was already invalidated, so a stale L2 row
      // is at worst a brief window before the next reader's transpile
      // overwrites it (or the next invalidate retries the tombstone).
      this.#log.warn(
        `${MODULE_TRANSPILE_CACHE_TABLE} tombstone failed for ${this.url}${canonicalPath}: ${String(err)}`,
      );
    }
  }

  async #deleteAllTranspileCacheRows(): Promise<void> {
    try {
      // Bulk tombstone-and-bump rather than DELETE — same reason as
      // #deleteTranspileCacheRow: any in-flight writer captured the
      // pre-wipe generation and must see a bumped row when it tries
      // to UPSERT so the OCC WHERE clause rejects the stale write.
      // Note that this bumps existing rows but does not create new
      // tombstones for paths that didn't yet have a row; a writer
      // for one of those paths that captured generation 0 would still
      // succeed post-wipe, but that's a narrow window and currently
      // limited to the __testOnly bulk-wipe path.
      //
      // CS-11182: RETURNING canonical_path so we can surface a zero-row
      // result as a warning — a silent no-op here used to mask a
      // realm_url mismatch between writer and bulk-wiper, leaving rows
      // live across a reindex.
      let updated = (await query(this.#dbAdapter, [
        'UPDATE',
        MODULE_TRANSPILE_CACHE_TABLE,
        'SET body = NULL, headers = NULL, dependency_keys = NULL,',
        `generation = ${MODULE_TRANSPILE_CACHE_TABLE}.generation + 1,`,
        'created_at =',
        param(Date.now()),
        'WHERE realm_url =',
        param(this.url),
        'RETURNING canonical_path',
      ])) as { canonical_path: string }[];
      if (updated.length === 0) {
        this.#log.warn(
          `${MODULE_TRANSPILE_CACHE_TABLE} bulk tombstone for ${this.url} matched zero rows`,
        );
      } else {
        this.#log.debug(
          `${MODULE_TRANSPILE_CACHE_TABLE} bulk tombstone for ${this.url} matched ${updated.length} row(s)`,
        );
      }
    } catch (err: unknown) {
      this.#log.warn(
        `${MODULE_TRANSPILE_CACHE_TABLE} bulk tombstone failed for ${this.url}: ${String(err)}`,
      );
    }
  }

  async #materializeAndTranspile(
    fileRef: FileRef,
    etag: string | undefined,
    caller: OperationCaller,
  ): Promise<ModuleTranspileResult> {
    let canonicalPath = this.paths.fileURL(fileRef.path).href;
    // The module's stored text, read as the `readSource` operation — the same
    // read the `card+source` route makes of the same path. What is compiled
    // below is what that read returned, so a module's bytes reach a client
    // through one read of them however they were asked for.
    //
    // The path handed to the read is the resolved one, extension fallback
    // included; the handle the caller resolved with is not read from. Its stat
    // is what the `ETag` was built from and what the `Last-Modified` below
    // reports, and the bytes are this read's — the same pairing of a stat with
    // bytes read after it that a byte route reading one handle has.
    //
    // Nothing below reads the realm's own record of the path — the validator
    // is the modification time's — so the read is told to leave that row
    // alone. Here that is a requirement and not a saving: a coordinated
    // compile runs this inside a window where it holds one pool connection
    // pinned, and a second checkout from inside that window is what the
    // coordination exists to prevent.
    let stored = await this.#readStoredSource(caller, fileRef.path, {
      skipStoredFileMeta: true,
    });
    if (!stored) {
      // The path resolved to a file and that file is gone: a delete landing
      // between the two. This route answers every failure to produce a module
      // as a 406 whose body repeats that status, so the refusal is reported
      // the way one raised deeper in the compile is, rather than under a
      // status of its own that would leave the body and the response
      // disagreeing.
      throw new CardError(
        `${canonicalPath} was deleted before it could be compiled`,
        { status: 406, title: 'Module transpilation failed' },
      );
    }
    // The one touch of `body`, which is where a streaming adapter opens its
    // stream. It is present because this read asked for the bytes — the mode
    // is chosen by the call above, which passes no headers-only option.
    let source = await fileContentToText({
      content: stored.body as FileRef['content'],
    });
    let transpiled: string;
    try {
      // Force an absolute path so babel's internal path.resolve doesn't depend
      // on process.cwd(), which differs between node and browser shims and was
      // observed to drop the leading slash on vite builds — producing a
      // moduleName of "dir/person.gts" instead of "/dir/person.gts" in
      // compiled templates.
      let debugFilename = fileRef.path.startsWith('/')
        ? fileRef.path
        : `/${fileRef.path}`;
      if (this.#testOnlyTranspileDelay) {
        await this.#testOnlyTranspileDelay();
      }
      this.#transpileCallCount += 1;
      transpiled = await transpileJS(source, debugFilename);
    } catch (err: any) {
      let cardError =
        err instanceof CardError
          ? err
          : new CardError(err?.message ?? 'Module transpilation failed', {
              status: 406,
              title: 'Module transpilation failed',
            });
      cardError.stack = err?.stack ?? cardError.stack;
      throw cardError;
    }

    let headers: Record<string, string> = {
      'content-type': 'text/javascript',
      'cache-control': 'public, max-age=0',
    };
    if (etag) {
      headers.etag = etag;
    }
    if (fileRef.lastModified != null) {
      headers['last-modified'] = formatRFC7231(fileRef.lastModified * 1000);
    }
    headers['X-Boxel-Canonical-Path'] = canonicalPath;

    // Compute deps once here so callers (L1 write site, L2 persist)
    // reuse them. Carrying the set through the L2 row lets a peer
    // skip this scan entirely on a cross-process cache hit.
    let dependencyKeys = extractModuleDependencyKeys(
      transpiled,
      fileRef.path,
      this.url,
      this.paths,
    );

    return {
      kind: 'module',
      canonicalPath: fileRef.path,
      body: transpiled,
      headers,
      dependencyKeys,
    };
  }

  private moduleErrorResponse(
    url: string,
    error: unknown,
    requestContext: RequestContext,
  ): Response {
    let cardError =
      error instanceof CardError
        ? error
        : new CardError(
            error instanceof Error ? error.message : String(error),
            { status: 406, title: 'Module transpilation failed' },
          );
    let errorJSON = formattedError(url, undefined, cardError);
    return createResponse({
      body: JSON.stringify(errorJSON),
      init: {
        status: 406,
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
  }

  // Verifies a capture-URL token (`?token=` on a `_screenshot/` GET) and
  // returns the user it authenticates, or undefined so the caller falls back
  // to the normal permission check. Every rejection is a fall-through, never
  // a thrown 401: an invalid token must not fail a request that public
  // permissions would authorize. The checks mirror the invariants the other
  // token families enforce: the family's own signing key (and, behind it, the
  // scope claim) keeps session JWTs out of query strings, the realm claim
  // keeps a token minted for realm A from replaying against realm B (that key
  // is derived from the server-wide seed, so it is shared across realms), the
  // URL binding keeps it from replaying against any other capture, the
  // revocation check keeps an operator revocation authoritative over every
  // family, and the realm-read check keeps the grant no more durable than the
  // permission it was minted from — the handler-verifies-itself precedent
  // from handle-download-realm.
  private async verifyCaptureURLToken(
    request: Request,
    localPath: LocalPath,
    requestContext: RequestContext,
  ): Promise<string | undefined> {
    let searchParams = new URL(request.url).searchParams;
    let tokenString = searchParams.get(CAPTURE_URL_TOKEN_PARAM);
    if (!tokenString) {
      return undefined;
    }
    let claims: CaptureURLTokenClaims & { iat: number; exp: number };
    try {
      claims = this.#adapter.verifyJWT(
        tokenString,
        captureURLTokenSecret(this.#realmSecretSeed),
      ) as unknown as CaptureURLTokenClaims & { iat: number; exp: number };
    } catch (e) {
      this.#log.warn(
        `capture-url token failed verification for GET ${maskLoggedURL(request.url)}: ${e}`,
      );
      return undefined;
    }
    if (claims.scope !== CAPTURE_URL_TOKEN_SCOPE) {
      this.#log.warn(
        `capture-url token for GET ${maskLoggedURL(request.url)} carries scope ${JSON.stringify(
          (claims as { scope?: unknown }).scope,
        )}, not ${CAPTURE_URL_TOKEN_SCOPE}`,
      );
      return undefined;
    }
    if (ensureTrailingSlash(claims.realm) !== ensureTrailingSlash(this.url)) {
      this.#log.warn(
        `capture-url token for GET ${maskLoggedURL(request.url)} is scoped to realm ${claims.realm}, not ${this.url}`,
      );
      return undefined;
    }
    let binding = captureURLTokenBinding(localPath, searchParams);
    if (claims.url !== binding) {
      this.#log.warn(
        `capture-url token for GET ${maskLoggedURL(request.url)} is bound to "${claims.url}", not "${binding}"`,
      );
      return undefined;
    }
    if (await isSessionRevoked(this.#dbAdapter, claims.user, claims.iat)) {
      this.#log.warn(
        `capture-url token for GET ${maskLoggedURL(request.url)} was issued at ${claims.iat}, which predates user ${claims.user}'s session revocation`,
      );
      return undefined;
    }
    // Realm read is re-derived from the live permission rows on every
    // request for the other token families — a normal session's
    // `permissions` claim is compared against the freshly computed union, a
    // delegated session is `can(user, 'read')`-checked — so this one is too.
    // Without it, revoking a user's read on the realm would leave every
    // capture URL they already minted working until the token expired.
    // Last, so an unauthorized token costs no permission lookup. The realm's
    // own matrix user is exempt for the same reason `checkPermission` exempts
    // it: it is permitted every action, and it is the gate the mint went
    // through — a principal that can mint here must be able to serve here.
    let permissionChecker = new RealmPermissionChecker(
      requestContext.permissions,
      this.#matrixClient,
    );
    if (
      claims.user !== this.#matrixClientUserId &&
      !(await permissionChecker.can(claims.user, 'read'))
    ) {
      this.#log.warn(
        `capture-url token for GET ${maskLoggedURL(request.url)} names user ${claims.user}, who does not have read permission on ${this.url}`,
      );
      return undefined;
    }
    return claims.user;
  }

  // Mints capture-URL tokens: signed variants of this realm's `_screenshot/`
  // URLs that authorize their own GET without a header, for the fetches the
  // host's auth service worker cannot reach. Routed as QUERY (a pure
  // computation with a body), so the realm-read gate the serving path
  // enforces is exactly the gate on minting — the token grants nothing the
  // caller doesn't already hold; it only makes that grant portable. An
  // anonymous caller (a public realm's reader) gets the URLs echoed back
  // unsigned: there is no user to bind a token to, and none is needed where
  // anonymous read already serves.
  private async signCaptureURLs(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let urls: unknown;
    try {
      let body = JSON.parse(await request.text()) as { urls?: unknown };
      urls = body.urls;
    } catch {
      return badRequest({
        message: 'Request body must be JSON with a "urls" array',
        requestContext,
      });
    }
    if (
      !Array.isArray(urls) ||
      urls.length === 0 ||
      urls.length > MAX_CAPTURE_URLS_PER_SIGNING_REQUEST ||
      !urls.every((u): u is string => typeof u === 'string')
    ) {
      return badRequest({
        message: `"urls" must be an array of 1-${MAX_CAPTURE_URLS_PER_SIGNING_REQUEST} strings`,
        requestContext,
      });
    }
    let user = requestContext.authenticatedUser;
    let signed: {
      url: string;
      signedUrl: string;
      expiresAt: string | null;
    }[] = [];
    for (let urlString of urls) {
      let url: URL;
      try {
        url = new URL(urlString);
      } catch {
        return badRequest({
          message: `"${urlString}" is not a valid URL`,
          requestContext,
        });
      }
      if (!this.paths.inRealm(url)) {
        return badRequest({
          message: `"${urlString}" is not in realm ${this.url}`,
          requestContext,
        });
      }
      let localPath = this.paths.local(url);
      if (!isCaptureServingPath(localPath)) {
        return badRequest({
          message: `"${urlString}" is not a ${CAPTURE_SERVING_PREFIX} URL`,
          requestContext,
        });
      }
      if (!user) {
        signed.push({ url: urlString, signedUrl: urlString, expiresAt: null });
        continue;
      }
      let claims: CaptureURLTokenClaims = {
        user,
        realm: this.url,
        scope: CAPTURE_URL_TOKEN_SCOPE,
        url: captureURLTokenBinding(localPath, url.searchParams),
      };
      // Signed under the capture family's own key, not the realm seed the
      // session families share — see `captureURLTokenSecret`.
      let token = this.#adapter.createJWT(
        claims as unknown as TokenClaims,
        CAPTURE_URL_TOKEN_TTL,
        captureURLTokenSecret(this.#realmSecretSeed),
      );
      let signedUrl = new URL(url.href);
      signedUrl.searchParams.set(CAPTURE_URL_TOKEN_PARAM, token);
      signed.push({
        url: urlString,
        signedUrl: signedUrl.href,
        expiresAt: new Date(
          Date.now() + CAPTURE_URL_TOKEN_TTL_MS,
        ).toISOString(),
      });
    }
    return createResponse({
      body: JSON.stringify({ signed }),
      init: {
        headers: { 'content-type': SupportedMimeType.JSON },
      },
      requestContext,
    });
  }

  // The realm's screenshot-serving surface: `_screenshot/{instanceLocalPath}`
  // resolves a capture of one instance and streams it from the MediaCache
  // with content-hash ETags and short-max-age revalidation (see
  // `media-cache-serving.ts` for the response contract). The durable URL is
  // the only public reference — MediaCache hashes surface solely as ETags —
  // so a re-capture changes what the URL serves, never the URL itself.
  //
  // Beyond realm read (enforced by internalHandle before dispatch), the
  // parent instance must be live: this gives per-instance ACLs a place to
  // land, and captures of a deleted instance stop serving the moment its
  // index tombstone appears, ahead of GC reclaiming their artifacts. The
  // gate is a narrow index read (`liveInstanceGeneration`) that returns the
  // live instance's generation for the cache key, never a full hydration — it
  // runs on every request, 304 revalidations included. Any request that
  // resolves to no capture — instance missing or errored,
  // store unconfigured, addressing unresolvable — is an uncaptured miss:
  // 404 with a short max-age so an `<img>` picks up a later capture on
  // revalidation, never a synchronous wait inside an image load.
  private async serveScreenshot(
    request: Request,
    requestContext: RequestContext,
    instanceLocalPath: string,
  ): Promise<ResponseWithNodeStream> {
    if (!this.#mediaCacheAdapter) {
      return mediaCacheMissResponse({ requestContext });
    }
    let requestStart = Date.now();
    let instanceURL = this.paths.fileURL(
      instanceLocalPath.replace(/\.json$/, ''),
    );
    let searchParams = new URL(request.url).searchParams;
    // The capture-URL token is an authorization credential, not addressing —
    // verified upstream in internalHandle. Dropped here so it reaches neither
    // the `name=` exclusivity check nor the capture-spec parse (which refuses
    // unknown params by name), and so it can never enter the ledger identity.
    searchParams.delete(CAPTURE_URL_TOKEN_PARAM);

    // `name=` addresses a declared screenshot through the instance's
    // manifest — a different addressing form from the capture-spec params,
    // so mixing them is a request with two contradictory identities.
    let name = searchParams.get('name');
    if (name !== null) {
      let extraParams = [...new Set(searchParams.keys())].filter(
        (key) => key !== 'name',
      );
      if (extraParams.length > 0) {
        return badRequest({
          message: `name cannot be combined with capture parameters ("${extraParams[0]}")`,
          requestContext,
        });
      }
      if (!isValidScreenshotName(name)) {
        return badRequest({
          message: `"${name}" is not a valid screenshot name`,
          requestContext,
        });
      }
      // The manifest read doubles as the liveness gate (same row predicate
      // as the DSL path's generation read): undefined means the instance is
      // missing, deleted, or errored. A live instance with no manifest, or
      // a manifest without this name — not yet captured, capture-errored,
      // or never declared — is an uncaptured miss with a short max-age, so
      // an `<img>` embedded ahead of its capture picks it up on
      // revalidation. Names never trigger capture work: declared captures
      // are produced by the prerender pass alone.
      //
      // Names address the URL's file row too: a FileDef family's declared
      // captures persist there, keyed by the file's own URL with its
      // extension intact (only an instance id sheds `.json`). A path that
      // names a file by a registered extension reads the file row first;
      // any other path reads the instance first — with the other row as the
      // fallback either way, so an extensionless file (`LICENSE`) still
      // resolves.
      let rawFileURL = this.paths.fileURL(instanceLocalPath);
      let manifestLookupStart = Date.now();
      let readInstance = async () => {
        let row =
          await this.#realmIndexQueryEngine.liveInstanceScreenshots(
            instanceURL,
          );
        return row && ({ kind: 'instance', ...row } as const);
      };
      let readFileRow = async () => {
        let row =
          await this.#realmIndexQueryEngine.liveFileScreenshots(rawFileURL);
        return row && ({ kind: 'file', ...row } as const);
      };
      let reads = urlNamesFile(rawFileURL)
        ? [readFileRow, readInstance]
        : [readInstance, readFileRow];
      // The first live row whose manifest holds the name wins — a URL both
      // rows answer to (a `.json` file that is also a card) must resolve to
      // the row that actually captured this slot, not 404 against the other
      // row's empty manifest. The ledger key comes from the matched row's
      // own canonical url, never the request's spelling: the lookups also
      // match `file_alias`, and an alias-addressed hit would otherwise look
      // up a source URL the ledger never held.
      let manifestEntry: ScreenshotManifestEntry | undefined;
      let manifestSourceURL = instanceURL.href;
      for (let read of reads) {
        let row = await read();
        if (!row) {
          continue;
        }
        let entry = row.manifest?.[name];
        if (entry) {
          manifestEntry = entry;
          manifestSourceURL = screenshotLedgerSourceURL(row.url, row.kind);
          break;
        }
      }
      let manifestLookupMs = Date.now() - manifestLookupStart;
      if (!manifestEntry) {
        return mediaCacheMissResponse({ requestContext });
      }
      // The manifest names both the capture identity (`specHash`) and the
      // exact artifact (`objectKey`), and the lookup pins both — so what
      // this URL serves always matches the `hash` the joined
      // `meta.screenshots` advertises for it, whatever newer ledger rows
      // exist (media persists before its manifest publishes, and a
      // carried-forward capture's row keeps an older generation). A fresher
      // capture serves once its own manifest publishes moments later; a
      // pinned object whose row is gone is an uncaptured miss that the
      // short max-age self-heals.
      let ledgerLookupStart = Date.now();
      let entry = await findMediaCacheEntry(this.#dbAdapter, {
        realmURL: this.url,
        sourceURL: manifestSourceURL,
        captureSpecHash: manifestEntry.specHash,
        objectKey: manifestEntry.objectKey,
      });
      if (!entry) {
        return mediaCacheMissResponse({ requestContext });
      }
      let perf: ScreenshotServePerf = {
        requestStart,
        correlationId: sanitizeLoggingCorrelationId(
          request.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
        ),
        generationLookupMs: manifestLookupMs,
        ledgerLookupMs: Date.now() - ledgerLookupStart,
        contentType: entry.contentType as CaptureContentType,
      };
      let serveStart = Date.now();
      let response = await serveMediaCacheEntry({
        request,
        requestContext,
        entry,
        mediaCacheAdapter: this.#mediaCacheAdapter,
        dbAdapter: this.#dbAdapter,
      });
      this.emitScreenshotServePerf(
        {
          realmURL: this.url,
          sourceURL: manifestSourceURL,
          captureSpecHash: manifestEntry.specHash,
          sourceGeneration: entry.sourceGeneration,
        },
        perf,
        'hit',
        {
          lane: entry.lane,
          serveMs: Date.now() - serveStart,
        },
        'get-named',
      );
      return response;
    }

    // One narrow read is both the liveness gate and the cache key's
    // generation: undefined means the instance is missing, deleted, or
    // errored — an uncaptured miss — and otherwise it pins the generation an
    // edit bumps, without hydrating the row.
    let generationLookupStart = Date.now();
    let sourceGeneration =
      await this.#realmIndexQueryEngine.liveInstanceGeneration(instanceURL);
    let generationLookupMs = Date.now() - generationLookupStart;
    if (sourceGeneration === undefined) {
      return mediaCacheMissResponse({ requestContext });
    }

    let parsed = parseCaptureSpecParams(searchParams);
    if ('error' in parsed) {
      return badRequest({ message: parsed.error.message, requestContext });
    }

    // The cache key pins the instance's own index generation: an edit bumps
    // it, so an edited card can never serve a stale capture, and an
    // unchanged card is a pure ledger hit with zero Chrome work.
    let entryKey: MediaCacheEntryKey = {
      realmURL: this.url,
      sourceURL: instanceURL.href,
      captureSpecHash: await captureSpecHash(parsed.spec),
      sourceGeneration,
    };
    let ledgerLookupStart = Date.now();
    let entry = await findMediaCacheEntry(this.#dbAdapter, entryKey);
    let perf: ScreenshotServePerf = {
      requestStart,
      correlationId: sanitizeLoggingCorrelationId(
        request.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
      ),
      generationLookupMs,
      ledgerLookupMs: Date.now() - ledgerLookupStart,
      contentType: captureOutputContentType(parsed.spec.type ?? 'png'),
    };
    if (entry) {
      // A hit costs zero Chrome work, so hits serve regardless of the
      // realm's capture gate — however the capture came to be in the
      // ledger.
      let serveStart = Date.now();
      let response = await serveMediaCacheEntry({
        request,
        requestContext,
        entry,
        mediaCacheAdapter: this.#mediaCacheAdapter,
        dbAdapter: this.#dbAdapter,
      });
      this.emitScreenshotServePerf(entryKey, perf, 'hit', {
        lane: entry.lane,
        serveMs: Date.now() - serveStart,
      });
      return response;
    }
    return await this.captureScreenshotOnDemand(
      request,
      requestContext,
      entryKey,
      parsed.spec,
      perf,
    );
  }

  // Serve a hashed scoped-CSS module request (the `_scoped-css/` serving
  // space `scopedCSSServingHref` roots under this realm): look the stylesheet
  // up by content hash among THIS realm's interned rows and answer with the
  // same style-injecting JS module the inline form produces locally. The
  // realm-scoped lookup is always satisfiable — indexing interned every
  // stylesheet this realm's rows reference under this realm's own
  // `realm_url` — and it keeps a caller from probing whether some other
  // realm's stylesheet bytes exist by guessing hashes. The body is a pure
  // function of the URL, so it caches as immutable; visibility follows realm
  // readability like the sibling capture-serving route.
  //
  // A `.css` URL served as `text/javascript` is deliberate, not a mixup: the
  // consumer is `loader.import`, so like any bundler's CSS import the URL
  // must resolve to a JS module whose evaluation injects the `<style>` tag,
  // and the content-type describes that body truthfully. The
  // `.glimmer-scoped.css` suffix is the upstream `glimmer-scoped-css` naming
  // that every scoped-CSS choke point keys on — in particular the Node-side
  // loader answers such URLs with an empty module instead of fetching, so an
  // injector that touches `document` never evaluates where none exists.
  //
  // Two caching decisions are load-bearing here, because a card's module graph
  // pulls hundreds of these URLs on one page load and each is its own request.
  //
  // `varyOnAccept: false` — the body is keyed entirely by the URL's content
  // hash, so the route never content-negotiates and must not claim it does
  // (see `createResponse`: a declared-but-unhonored `Vary` makes differing
  // `Accept` spellings evict each other's stored entry). This holds only
  // because the realm-server's index handler exempts these paths from the
  // `text/html` branch that answers realm URLs with the host app shell —
  // without that exemption the same URL would have two bodies, and the
  // year-long entry a browser stores could be either.
  //
  // No `ETag` — deliberately, and it is not an oversight to correct. The
  // consumer is the loader, whose `cachedFetch` layer conditionalizes any
  // request it holds a validator for by sending `If-None-Match`, and a
  // caller-supplied conditional header makes the browser skip its own cache
  // and revalidate against the server. `cachedFetch`'s store is a
  // module-scoped Map that starts empty in a fresh JS context, so the cost is
  // not the first fetch of a URL but every later one: a loader reset re-imports
  // the module graph in the same context, and each of those hundreds of URLs
  // then carries a validator and reaches the server instead of the browser
  // cache. An `immutable` year-long response with no validator stays silent
  // across all of them; the content hash in the URL is what makes that safe,
  // since changed bytes arrive under a different URL rather than needing this
  // one re-checked.
  private async serveHashedScopedCSS(
    request: Request,
    requestContext: RequestContext,
  ): Promise<ResponseWithNodeStream> {
    let pathname = new URL(request.url).pathname;
    let parsed = parseScopedCSSRequest(pathname);
    if (parsed.form !== 'hashed') {
      return notFound(request, requestContext);
    }
    let rows = (await query(this.#dbAdapter, [
      `SELECT css FROM scoped_css WHERE hash =`,
      param(parsed.cssHash),
      `AND realm_url =`,
      param(this.url),
      `LIMIT 1`,
    ])) as { css: string }[];
    if (rows.length === 0 || typeof rows[0].css !== 'string') {
      return notFound(request, requestContext);
    }
    return createResponse({
      body: scopedCSSInjectorSource(pathname, rows[0].css),
      init: {
        status: 200,
        headers: {
          'content-type': 'text/javascript',
          'cache-control': `${mediaCacheVisibility(requestContext)}, max-age=31536000, immutable`,
        },
      },
      requestContext,
      varyOnAccept: false,
    });
  }

  // The stage clocks `serveScreenshot` accumulates before the hit/miss
  // fork, threaded into the miss path so its terminal emit covers the whole
  // request.
  private emitScreenshotServePerf(
    entryKey: MediaCacheEntryKey,
    perf: ScreenshotServePerf,
    outcome: ScreenshotRequestPerfEvent['outcome'],
    fields: Partial<ScreenshotRequestPerfEvent> = {},
    surface: ScreenshotRequestPerfEvent['surface'] = 'get-dsl',
  ): void {
    emitScreenshotPerf({
      eventType: 'request',
      surface,
      outcome,
      realmURL: this.url,
      sourceURL: entryKey.sourceURL,
      captureSpecHash: entryKey.captureSpecHash,
      sourceGeneration: entryKey.sourceGeneration,
      lane: 'on-demand',
      correlationId: perf.correlationId,
      jobId: null,
      reservationId: null,
      hasTwin: null,
      contentType: perf.contentType,
      generationLookupMs: perf.generationLookupMs,
      ledgerLookupMs: perf.ledgerLookupMs,
      totalMs: Date.now() - perf.requestStart,
      ...fields,
    });
  }

  // The miss path: a capture no ledger entry satisfies. Full captureSpec
  // power on an unauthenticated-reachable GET is an unbounded spec space —
  // on an open realm every distinct viewport/dsf/fullPage/clip combination
  // is its own render and its own ledger entry — so new captures are
  // per-realm opt-in (`allowArbitraryScreenshots` on the realm's config
  // card — the gate blocks Chrome work, never serving). That opt-in is the
  // deliberate cost boundary: no per-instance spec-cardinality cap beyond
  // it, since the parse bounds each capture's pixel cost, the serialized
  // lane bounds concurrency, and the on-demand lane's idle TTL reclaims
  // entries nothing requests. An open realm's captures run through the same
  // per-realm serialized screenshot queue as the POST endpoint, bounded by
  // a sync-wait budget:
  //   - lane already too deep for the budget → immediate 503 + Retry-After
  //     (fail fast instead of holding a doomed connection);
  //   - otherwise enqueue and wait up to the budget; the job persists its
  //     capture to the MediaCache itself, so a wait that times out (503 +
  //     Retry-After) still lands the capture and the client's retry is a
  //     pure ledger hit.
  private async captureScreenshotOnDemand(
    request: Request,
    requestContext: RequestContext,
    entryKey: MediaCacheEntryKey,
    spec: CaptureSpec,
    perf: ScreenshotServePerf,
  ): Promise<ResponseWithNodeStream> {
    let gateStart = Date.now();
    let gateOpen = await this.allowsArbitraryScreenshots();
    let gateMs = Date.now() - gateStart;
    if (!gateOpen) {
      this.emitScreenshotServePerf(entryKey, perf, 'gated', { gateMs });
      // 403 isn't heuristically cacheable, so with no explicit freshness a
      // browser re-requests on every `<img>` load — and absent-⇒-false means
      // every realm is gated by default. Carry the same short window the miss
      // uses so a gated realm's image loads stop hammering the origin (and so
      // opting the realm in surfaces images within that same window).
      return createResponse({
        body: `This realm does not allow arbitrary screenshot captures: set "allowArbitraryScreenshots" to true on the realm's config card to enable them. Captures that already exist still serve.`,
        init: {
          status: 403,
          headers: {
            'cache-control': `${mediaCacheVisibility(requestContext)}, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
          },
        },
        requestContext,
      });
    }

    // Render as the realm's owner — the same identity an index pass renders
    // under. The requester already proved realm read; the capture is a
    // realm-derived artifact, not a per-user view. Resolved ahead of the
    // congestion pre-check because the twin probe matches on `runAs`.
    let owner = await this.getRealmOwnerUserId();

    let concurrencyGroup = `screenshot:${this.url}`;
    let precheckStart = Date.now();
    let estimate = await estimateScreenshotQueueWait(
      this.#dbAdapter,
      concurrencyGroup,
      { ...entryKey, runAs: owner },
    );
    let precheckMs = Date.now() - precheckStart;
    // A request whose capture is already queued or rendering coalesces onto
    // that job (see `chooseScreenshotCardCoalesceDecision`) and costs no new
    // Chrome work, so the lane's depth is not its wait — only a genuinely new
    // capture faces the congestion gate. Without this, the second viewer of a
    // card that is mid-render is 503'd against a wait it would never incur.
    if (
      !estimate.hasTwin &&
      estimate.estimatedWaitMs > this.#screenshotSyncWaitMs
    ) {
      this.emitScreenshotServePerf(entryKey, perf, 'congested', {
        gateMs,
        precheckMs,
        hasTwin: estimate.hasTwin,
      });
      return this.screenshotRetryLater(
        requestContext,
        estimate.estimatedWaitMs,
      );
    }

    let enqueueStart = Date.now();
    let job = await enqueueScreenshotCardJob(
      {
        realmURL: this.url,
        realmUsername: owner,
        runAs: owner,
        cardId: entryKey.sourceURL,
        format: spec.format,
        // The spec's geometry overrides (viewport / dsf / fullPage / clip)
        // ride to the capture engine; the entry key's `captureSpecHash`
        // already covers them, so the persisted capture serves only on this
        // exact spec's URL.
        captureSpec: captureSpecOverrides(spec),
        persist: { ...entryKey, lane: 'on-demand' },
        surface: 'get-dsl',
        loggingCorrelationId: perf.correlationId,
      },
      this.#queue,
      this.#dbAdapter,
      userInitiatedPriority,
    );
    let enqueueMs = Date.now() - enqueueStart;
    let jobWaitStart = Date.now();
    let stagePerf: Partial<ScreenshotRequestPerfEvent> = {
      gateMs,
      precheckMs,
      hasTwin: estimate.hasTwin,
      enqueueMs,
      jobId: job.id,
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    // `const` so the symbol gets a unique-symbol type and the race result
    // narrows on comparison.
    const timedOut = Symbol('sync-wait-timeout');
    try {
      let outcome = await Promise.race([
        job.done,
        new Promise<typeof timedOut>((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve(timedOut),
            this.#screenshotSyncWaitMs,
          );
          timeoutHandle.unref?.();
        }),
      ]);
      if (outcome === timedOut) {
        this.emitScreenshotServePerf(entryKey, perf, 'timeout', {
          ...stagePerf,
          jobWaitMs: Date.now() - jobWaitStart,
        });
        // The job keeps running and persists its own capture; the retry
        // hint is one average capture, since this request is now at the
        // front of the lane.
        return this.screenshotRetryLater(
          requestContext,
          Math.max(estimate.avgCaptureMs, 1000),
        );
      }
      let jobWaitMs = Date.now() - jobWaitStart;
      // Prefer the ledger entry the job persisted; fall back to persisting
      // here from the response for a worker that has no store configured.
      let entry = await findMediaCacheEntry(this.#dbAdapter, entryKey);
      if (!entry && outcome.status === 'ready' && outcome.base64) {
        let binary = atob(outcome.base64);
        let bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        await putMedia(this.#dbAdapter, this.#mediaCacheAdapter!, {
          ...entryKey,
          bytes,
          contentType: outcome.contentType ?? 'image/png',
          width: outcome.width ?? null,
          height: outcome.height ?? null,
          lane: 'on-demand',
        });
        entry = await findMediaCacheEntry(this.#dbAdapter, entryKey);
      }
      if (!entry) {
        this.emitScreenshotServePerf(entryKey, perf, 'error', {
          ...stagePerf,
          jobWaitMs,
        });
        let response = systemError({
          requestContext,
          message: `screenshot capture failed for ${entryKey.sourceURL}`,
          additionalError: outcome.error
            ? new Error(String(outcome.error))
            : undefined,
        });
        // A failed capture persists nothing, so no ledger entry will
        // short-circuit the repeat: without explicit freshness every `<img>`
        // load of this URL is a fresh Chrome render. Some failures are
        // durable properties of the request — a fullPage capture whose
        // document extent exceeds the physical-pixel cap fails every time,
        // and only the capture engine can discover that. Carry the same
        // short window the miss and gate responses use, so a capture that
        // keeps failing costs one render per window rather than one per
        // image load.
        response.headers.set(
          'cache-control',
          `${mediaCacheVisibility(requestContext)}, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
        );
        return response;
      }
      let serveStart = Date.now();
      let response = await serveMediaCacheEntry({
        request,
        requestContext,
        entry,
        mediaCacheAdapter: this.#mediaCacheAdapter!,
        dbAdapter: this.#dbAdapter,
      });
      this.emitScreenshotServePerf(entryKey, perf, 'rendered', {
        ...stagePerf,
        jobWaitMs,
        serveMs: Date.now() - serveStart,
      });
      return response;
    } catch (e: any) {
      // A job that throws (the queue rejected it: a prerender that exhausted
      // its retries, a reservation-lease timeout) rejects `job.done` and
      // lands here — without this emit, the pipeline's hard-failure class
      // would read on the telemetry board as missing request volume instead
      // of a rise in `error`.
      this.emitScreenshotServePerf(entryKey, perf, 'error', {
        ...stagePerf,
        jobWaitMs: Date.now() - jobWaitStart,
      });
      return systemError({
        requestContext,
        message: `screenshot capture failed for ${entryKey.sourceURL}`,
        additionalError: e instanceof Error ? e : new Error(String(e)),
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private screenshotRetryLater(
    requestContext: RequestContext,
    estimatedWaitMs: number,
  ): Response {
    let retryAfterSeconds = Math.max(1, Math.ceil(estimatedWaitMs / 1000));
    return createResponse({
      // Every other refusal on this route names its reason (the 400s name the
      // field, the 403 names the flag); a sync-wait caller honoring
      // Retry-After gets one too.
      body: `Screenshot capture is queued; retry after ${retryAfterSeconds} seconds.`,
      init: {
        status: 503,
        headers: {
          'retry-after': String(retryAfterSeconds),
        },
      },
      requestContext,
    });
  }

  // The per-realm opt-in for GET-triggered captures, read from the realm's
  // indexed config card on every check — so a `realm.json` edit takes
  // effect with its own index update, with no restart and no cache to
  // invalidate. Absent, unindexed, or anything but `true` all read as
  // gated.
  private async allowsArbitraryScreenshots(): Promise<boolean> {
    let realmConfigCardURL = new URL(
      this.paths.fileURL('realm.json').href.replace(/\.json$/, ''),
    );
    let entry = await this.#realmIndexQueryEngine.instance(realmConfigCardURL);
    if (entry?.type !== 'instance') {
      return false;
    }
    return entry.instance.attributes?.allowArbitraryScreenshots === true;
  }

  // The stored bytes at `localPath`, read as the `readSource` operation. Every
  // route that serves a path's stored bytes gets what it sends from here — the
  // `card+source` `GET`/`HEAD`, the raw file serve, and the module serve,
  // which compiles what comes back rather than sending it — so there is one
  // place that read happens however a client asked for those bytes.
  //
  // Reads that produce something other than the bytes are their own: the
  // file-meta route opens the file to hash and measure it, and the
  // not-indexed-yet check reads a `.json` to decide whether the index will
  // ever have a row for it. Neither serves what it read.
  //
  // The caller has already resolved which file it means, including any
  // extension fallback, and has a handle on it. The dispatch is given the
  // resolved path rather than the requested one: a read answers for the bytes
  // it returns, and a fallback would otherwise leave the content type
  // describing one file and everything else another.
  //
  // A refusal here is a file that stopped existing between the caller's
  // resolution and this read — a delete landing in that window — so it becomes
  // the 404 the same request a moment later would have produced. Nothing else
  // this operation can refuse is reachable: the path is resolved, so it is
  // neither a directory nor a name the realm declines to serve.
  // The caller is passed rather than the request it came from: the module
  // serve's read happens inside work shared between concurrent requests, where
  // there is no one request to take it from.
  async #readStoredSource(
    caller: OperationCaller,
    localPath: LocalPath,
    opts: { headersOnly?: true; skipStoredFileMeta?: true } = {},
  ): Promise<OperationSourceResult | undefined> {
    let result: OperationResult;
    try {
      result = await runOperation(
        this.operationCore,
        {
          target: {
            kind: 'instance',
            url: this.paths.fileURL(localPath).href,
          },
          name: 'readSource',
          ...caller,
        },
        // No route reaching here validates on the read's `version` — each
        // builds its own validator, from the bytes it caches or from the
        // modification time — so none should pay to have one read off disk
        // for it.
        { ...opts, skipContentFingerprint: true },
      );
    } catch (e) {
      if (!isOperationFailure(e)) {
        throw e;
      }
      if (e.error.code === 'target-not-found') {
        return undefined;
      }
      // Any other refusal carries a status the operation chose, and what
      // carries that status the rest of the way is a `CardError` — a bare
      // refusal reaching the source route's router would answer 500 for
      // something that named its own answer. Nothing a stored-bytes read can
      // refuse reaches here today, the resolved path having ruled out the rest,
      // so this is about the next refusal added to that executor rather than a
      // live fault.
      //
      // It carries the status only as far as the source route. The byte serve
      // is reached through the module fallback, whose own error handling
      // answers every throw alike, so a refusal there arrives under that
      // handler's status rather than this one — as every error on that path
      // already does.
      throw new CardError(e.error.detail, {
        status: e.error.status,
        title: e.error.title,
        id: e.error.id,
      });
    }
    if (!isSourceResult(result)) {
      throw new Error(
        `bug: readSource of ${localPath} in realm ${this.url} did not answer with stored bytes`,
      );
    }
    return result;
  }

  // What a byte route hands `serveLocalFile`: the operation's answer, in the
  // shape the response assembly reads.
  //
  // Two members come from the handle rather than from the result, and for the
  // same reason. A `Range` is served by reading bounded slices of the file,
  // which is a capability of the adapter's handle and not a value a result can
  // carry; `size` decides whether a range can be offered at all, and the
  // handle is what the caller measured when it resolved the path. Everything a
  // client can see about the content — the bytes, when they changed, what type
  // they are — is the operation's.
  //
  // `content` stays a getter so that resolving it remains the response
  // assembly's decision. A 304 and a 206 both send bytes this never opens, and
  // a headers-only read has none to open — which is sound for the same reason:
  // the assembly reaches `content` only where it is about to send it, and a
  // read is asked for headers only where the route will not.
  #servableSource(handle: FileRef, source: OperationSourceResult): FileRef {
    // `this` inside the getter below is the ref, not the realm.
    let realmURL = this.url;
    let ref: FileRef = {
      path: handle.path,
      get content() {
        if (source.body === undefined) {
          // A headers-only read has no bytes, and every route that asks for
          // one is a route that will not send any. Nothing binds those two
          // decisions together — they are separate tests of the request's
          // method, in separate methods — so this says what went wrong at the
          // point it went wrong rather than letting `undefined` travel on as a
          // body and surface as an empty response.
          throw new Error(
            `bug: response for ${handle.path} in realm ${realmURL} reached for bytes a headers-only read did not fetch`,
          );
        }
        return source.body as FileRef['content'];
      },
      lastModified: source.lastModified,
      ...(source.size != null ? { size: source.size } : {}),
      ...(handle.createRangeStream
        ? { createRangeStream: handle.createRangeStream }
        : {}),
    };
    // A shimmed module is not stored content at all, and the response says so
    // in a header of its own; the marker rides on the handle.
    for (let symbol of Object.getOwnPropertySymbols(handle)) {
      (ref as any)[symbol] = (handle as any)[symbol];
    }
    return ref;
  }

  private async serveLocalFile(
    request: Request,
    ref: FileRef,
    requestContext: RequestContext,
    options?: {
      defaultHeaders?: Record<string, string>;
      etagVariant?: string;
      // Optional content-derived fingerprint derived from the body bytes.
      // Takes precedence over `ref.lastModified` for the ETag — see
      // `buildEtag`. Callers that have the materialized body already
      // (the source endpoint cache-miss path) compute this for free.
      etagBase?: string;
      // When the realm first saw this path, for a caller that already read the
      // file's stored metadata and so already has it. Supplying it is what
      // keeps such a caller from reading the same row twice per request.
      // Present and null means the realm holds no record of the path, which is
      // an answer — so the key being there at all, rather than its value, is
      // what decides whether this looks the value up itself.
      createdAt?: number | null;
    },
  ): Promise<ResponseWithNodeStream> {
    let contentType = options?.defaultHeaders?.['content-type'];
    // Only advertise `public` caching when the realm is world-readable;
    // otherwise the response is auth-gated and must not be stored by shared
    // caches (e.g. CDNs) where it could be served to another user.
    let cacheVisibility = requestContext.permissions['*']?.includes('read')
      ? 'public'
      : 'private';
    // Serve realm-hosted images (e.g. realm icons and backgrounds) with an
    // explicit Cache-Control so browsers don't fall back to Last-Modified
    // heuristics. must-revalidate + ETag keeps updates responsive while
    // avoiding repeated revalidation within a browsing session.
    let cacheControl = contentType?.startsWith('image/')
      ? `${cacheVisibility}, max-age=60, must-revalidate`
      : `${cacheVisibility}, max-age=0`;
    let etag = buildEtag(
      totalEtagBase(options?.etagBase, ref.lastModified) ?? ref.lastModified,
      options?.etagVariant,
    );
    let lastModified = formatRFC7231(ref.lastModified * 1000);
    if (etag && request.headers.get('if-none-match') === etag) {
      return createResponse({
        body: null,
        init: {
          status: 304,
          headers: {
            'cache-control': cacheControl,
            'last-modified': lastModified,
            etag,
          },
        },
        requestContext,
      });
    }
    let createdFromDb =
      options && 'createdAt' in options
        ? options.createdAt
        : await this.getCreatedTime(ref.path);
    let headers: Record<string, string> = {
      ...(options?.defaultHeaders || {}),
      'last-modified': lastModified,
      ...(Symbol.for('shimmed-module') in ref
        ? { 'X-Boxel-Shimmed-Module': 'true' }
        : {}),
      ...(etag ? { etag } : {}),
      'cache-control': cacheControl,
    };
    if (createdFromDb != null) {
      headers['x-created'] = formatRFC7231(createdFromDb * 1000);
    }

    // Byte size when knowable without reading the bytes. `ref.size` is
    // consulted before `ref.content` because adapters expose `content` as a
    // lazy getter that opens a real stream on first touch — a ranged or 416
    // response must never pay for (and then strand) a full-file stream.
    // String bodies are left to the HTTP layer, which measures and sets
    // Content-Length for them itself.
    let sliceableBytes =
      ref.size == null && ref.content instanceof Uint8Array
        ? ref.content
        : undefined;
    let totalSize = ref.size ?? sliceableBytes?.byteLength;
    if (totalSize != null) {
      headers['content-length'] = String(totalSize);
    }
    let rangeCapable =
      totalSize != null &&
      (sliceableBytes != null || typeof ref.createRangeStream === 'function');
    if (rangeCapable) {
      headers['accept-ranges'] = 'bytes';
      let rangeHeader =
        request.method === 'GET' ? request.headers.get('range') : null;
      // A Range is conditional on If-Range when present: a validator that no
      // longer matches means the client's byte offsets refer to a different
      // representation, so the full body is the correct answer.
      let ifRange = request.headers.get('if-range');
      if (rangeHeader && (!ifRange || (etag && ifRange === etag))) {
        let resolution = resolveRangeHeader(rangeHeader, totalSize!);
        if (resolution.kind === 'unsatisfiable') {
          return createResponse({
            body: null,
            init: {
              status: 416,
              headers: {
                ...headers,
                'content-range': `bytes */${totalSize}`,
                'content-length': '0',
              },
            },
            requestContext,
          });
        }
        if (resolution.kind === 'range') {
          let { start, end } = resolution;
          let rangeHeaders = {
            ...headers,
            'content-range': `bytes ${start}-${end}/${totalSize}`,
            'content-length': String(end - start + 1),
          };
          if (sliceableBytes) {
            return createResponse({
              body: sliceableBytes.subarray(start, end + 1) as BodyInit,
              init: { status: 206, headers: rangeHeaders },
              requestContext,
            });
          }
          let rangeContent = ref.createRangeStream!(start, end);
          if (rangeContent instanceof ReadableStream) {
            return createResponse({
              body: rangeContent,
              init: { status: 206, headers: rangeHeaders },
              requestContext,
            });
          }
          if (!isNode) {
            throw new Error(
              `Cannot handle node stream in a non-node environment`,
            );
          }
          let response = createResponse({
            body: null,
            init: { status: 206, headers: rangeHeaders },
            requestContext,
          }) as ResponseWithNodeStream;
          response.nodeStream = rangeContent;
          return response;
        }
      }
    }

    // A `HEAD` is answered by the headers above and nothing else, so the bytes
    // are never reached for one. The protocol forbids a body here and the
    // server drops one anyway, so this changes no response — what it changes is
    // that `content` is not touched, and on a streaming adapter that property
    // is what opens the stream. A caller that has the metadata without the
    // bytes can therefore answer a `HEAD` with them.
    //
    // Only where the length is already known, though. `Content-Length` on a
    // `HEAD` has to describe the body the `GET` would send, and where the size
    // was not knowable without the bytes it is the body itself that is
    // measured — by the HTTP layer, for a `HEAD` as much as for a `GET`. So a
    // ref that could not report its size is served the way it always was, and
    // the header keeps coming from the one thing that can produce it. Such a
    // ref is materialized rather than streamed, so no stream is stranded by
    // passing it along.
    if (request.method === 'HEAD' && totalSize != null) {
      return createResponse({
        body: null,
        init: { headers },
        requestContext,
      });
    }

    if (
      ref.content instanceof ReadableStream ||
      ref.content instanceof Uint8Array ||
      typeof ref.content === 'string'
    ) {
      return createResponse({
        body: ref.content as BodyInit,
        init: { headers },
        requestContext,
      });
    }

    if (!isNode) {
      throw new Error(`Cannot handle node stream in a non-node environment`);
    }

    // add the node stream to the response which will get special handling in the node env
    let response = createResponse({
      body: null,
      init: { headers },
      requestContext,
    }) as ResponseWithNodeStream;

    response.nodeStream = ref.content;
    return response;
  }

  // `probe` asks whether a caller is permitted rather than enforcing it, which
  // changes two things. The realm-wide `HEAD` exemption does not apply — it
  // exists so a discovery probe reaches an answer without credentials, and a
  // caller taking it has not shown it may read anything. And a refusal is an
  // ordinary answer the caller has a fallback for, so it is not logged as a
  // failed request.
  private async checkPermission(
    request: Request,
    requestContext: RequestContext,
    requiredPermission: 'read' | 'write' | 'realm-owner',
    { probe = false }: { probe?: boolean } = {},
  ) {
    let realmPermissions = requestContext.permissions;
    // A refusal the caller asked for rather than ran into is not a failed
    // request, and logging every unauthenticated discovery probe as one buries
    // the refusals that are.
    let warnRefusal = (message: string) => {
      if (!probe) {
        this.#log.warn(message);
      }
    };
    if (
      requiredPermission !== 'realm-owner' &&
      (lookupRouteTable(this.#publicEndpoints, this.paths, request) ||
        (request.method === 'HEAD' && !probe) ||
        // If the realm is public readable or writable, do not require a JWT
        (requiredPermission === 'read' &&
          realmPermissions['*']?.includes('read')) ||
        (requiredPermission === 'write' &&
          realmPermissions['*']?.includes('write')))
    ) {
      // Authorized without needing a token. Record what we can about who the
      // caller is for the read endpoints' indexing gate (identity, not
      // authority — see RequestContext): a verifiable token identifies them,
      // and no Authorization header at all marks them anonymous. Two cases
      // deliberately leave both fields unset, landing the caller in the
      // gate's conservative bucket: a token that fails verification (must
      // not fail a request that public permissions already authorized), and
      // a request carrying `X-Boxel-Assume-User` — honoring the indirection
      // requires the assume-user permission check the main path runs (and
      // identity capture must stay free of matrix round-trips), while
      // recording the bearer instead would desynchronize this identity from
      // the assumed-user tag the same client's writes carry, since writes
      // always take the main path.
      let publicAuthHeader = request.headers.get('Authorization');
      if (!publicAuthHeader) {
        requestContext.anonymous = true;
      } else if (!request.headers.get('X-Boxel-Assume-User')) {
        try {
          let publicToken = this.#adapter.verifyJWT(
            publicAuthHeader.replace('Bearer ', ''),
            this.#realmSecretSeed,
          );
          requestContext.authenticatedUser = publicToken.user;
        } catch (e) {
          // fall through with no identity
        }
      }
      return;
    }

    let authorizationString = request.headers.get('Authorization');
    if (!authorizationString) {
      warnRefusal(
        `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}) missing auth header`,
      );
      throw new AuthenticationError(
        AuthenticationErrorMessages.MissingAuthHeader,
      );
    }
    let tokenString = authorizationString.replace('Bearer ', ''); // Parse the JWT

    let token: TokenClaims & { iat: number; exp: number };

    try {
      token = this.#adapter.verifyJWT(tokenString, this.#realmSecretSeed);

      // Checked against the token's bearer before any assume-user indirection,
      // and ahead of the delegated branch below, so revoking a user also kills
      // sessions delegated on their behalf.
      if (await isSessionRevoked(this.#dbAdapter, token.user, token.iat)) {
        warnRefusal(
          `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}), session for user ${token.user} was issued at ${token.iat} which predates that user's session revocation`,
        );
        throw new AuthenticationError(
          AuthenticationErrorMessages.SessionRevoked,
        );
      }

      let realmPermissionChecker = new RealmPermissionChecker(
        realmPermissions,
        this.#matrixClient,
      );

      let user = token.user;

      // Delegated read-only session (minted by the realm-server's
      // /_delegate-session endpoint for ai-bot — CS-11552). It is bound to a
      // single user and deliberately scoped to ['read'] even when that user
      // has broader permissions, so neither the exact-permissions-match
      // invariant used for normal sessions below nor the assume-user
      // indirection applies. Enforce instead the two guarantees the delegation
      // design promises: the session is read-only, and it grants no more than
      // the bound user can already read.
      if (token.delegated) {
        // Single-realm scope. Delegated tokens are signed with the realm-server
        // seed shared across every realm on this server and this branch skips
        // the normal exact-permissions match, so without this check a token
        // minted for realm A could be replayed against realm B whenever the
        // bound user also has read on B. Bind the token to the realm it names.
        if (
          ensureTrailingSlash(token.realm) !== ensureTrailingSlash(this.url)
        ) {
          warnRefusal(
            `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}), delegated session for user ${user} is scoped to realm ${token.realm}, not ${this.url}`,
          );
          throw new AuthenticationError(
            AuthenticationErrorMessages.TokenInvalid,
          );
        }
        if (requiredPermission !== 'read') {
          warnRefusal(
            `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}), delegated session for user ${user} attempted ${requiredPermission}; delegated sessions are read-only`,
          );
          throw new AuthorizationError('Delegated sessions are read-only');
        }
        if (!(await realmPermissionChecker.can(user, 'read'))) {
          warnRefusal(
            `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}), delegated session for user ${user} but user lacks read permission`,
          );
          throw new AuthenticationError(
            AuthenticationErrorMessages.PermissionMismatch,
          );
        }
        requestContext.authenticatedUser = user;
        return;
      }

      let assumedUser = request.headers.get('X-Boxel-Assume-User');
      let didAssumeUser = false;
      if (
        assumedUser &&
        (await realmPermissionChecker.can(user, 'assume-user'))
      ) {
        user = assumedUser;
        didAssumeUser = true;
      }

      // if the client is the realm matrix user then we permit all actions
      if (user === this.#matrixClientUserId) {
        requestContext.authenticatedUser = user;
        return;
      }

      let userPermissions = await realmPermissionChecker.for(user);
      if (
        !didAssumeUser &&
        JSON.stringify(token.permissions?.sort()) !==
          JSON.stringify(userPermissions.sort())
      ) {
        warnRefusal(
          `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}), for user ${user} token permissions do not match realm permissions for user. token permissions: ${JSON.stringify(token.permissions?.sort())}, user's realm permissions: ${JSON.stringify(userPermissions.sort())}`,
        );
        throw new AuthenticationError(
          AuthenticationErrorMessages.PermissionMismatch,
        );
      }

      if (!(await realmPermissionChecker.can(user, requiredPermission))) {
        warnRefusal(
          `auth failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}), for user ${user} permissions insufficient. requires ${requiredPermission}, but user permissions: ${JSON.stringify(userPermissions.sort())}`,
        );
        throw new AuthorizationError(
          'Insufficient permissions to perform this action',
        );
      }
      requestContext.authenticatedUser = user;
    } catch (e: any) {
      if (e?.constructor?.name === 'TokenExpiredError') {
        warnRefusal(
          `JWT verification failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}) with token string ${tokenString}. ${e.message}, expired at ${e.expiredAt}`,
        );
        throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
      }
      if (e?.constructor?.name === 'JsonWebTokenError') {
        warnRefusal(
          `JWT verification failed for ${request.method} ${maskLoggedURL(request.url)} (accept: ${request.headers.get('accept')}) with token string ${tokenString}. ${e.message}`,
        );
        throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
      }
      throw e;
    }
  }

  private async upsertCardSource(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    return await this.replaceFileContent(
      request,
      requestContext,
      await request.text(),
    );
  }

  private async upsertBinaryFile(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    return await this.replaceFileContent(
      request,
      requestContext,
      new Uint8Array(await request.arrayBuffer()),
    );
  }

  // The write behind both file-content routes: one `update` entry naming the
  // request's own path, committed as a batch of one.
  //
  // Both routes put whatever bytes they are given at whatever path they are
  // given, which is what `rawSource` means — so both set it, and only they
  // do. It is what lets them keep reaching the three things an update on a
  // file otherwise refuses: a module's source, a card instance's stored
  // `.json`, and a path with nothing at it yet, since these are the routes
  // that create the files they write. Through the operations envelope an
  // update on a card is instead the JSON:API merge its document describes and
  // one on a module is refused, because a caller able to ask for a verbatim
  // replacement of a card's source could write bytes that are no longer a
  // card and leave the realm to discover it at index time.
  //
  // Neither caller depends on indexed state — a caller that did would be
  // asking for `application/vnd.card+json` — so both return as soon as the
  // bytes are durable. Indexing follows on the queue, reports its errors
  // through `error_doc` as it does for any write, and broadcasts to
  // subscribers once the worker settles. The operations envelope has no such
  // opt-out: it reports a generation per entry, which only exists once the
  // index job has landed.
  private async replaceFileContent(
    request: Request,
    requestContext: RequestContext,
    content: string | Uint8Array,
  ): Promise<Response> {
    let url = new URL(request.url);
    let result: Awaited<ReturnType<typeof commitBatch>>[number];
    try {
      [result] = await commitBatch(
        this.batchCore,
        [{ op: 'update', href: url.href, content, rawSource: true }],
        {
          clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
          actor: requestContext.authenticatedUser ?? undefined,
          waitForIndex: false,
        },
      );
    } catch (err: unknown) {
      if (isOperationFailure(err)) {
        // A batch reports a refusal as an operations error, which is the
        // envelope's currency. This route answers in statuses, and the status
        // is what a caller acts on — an oversized payload has to keep reading
        // as "send less" rather than as "the realm is broken, try again". So
        // the refusal is carried back across as the error this route has
        // always thrown, keeping the status the batch chose.
        throw new CardError(err.error.detail ?? err.message, {
          status: err.error.status,
          title: err.error.title,
        });
      }
      throw err;
    }
    let lastModified = result?.meta.lastModified;
    if (result == null || lastModified == null) {
      // The commit reports a modification time for every file it writes, so
      // reaching here means the write did not land as one. Said out loud
      // rather than defaulted, since a default would answer 204 with a date
      // that describes no file.
      throw new CardError(
        `write of ${url.href} reported no modification time`,
        {
          status: 500,
          title: 'Internal Server Error',
        },
      );
    }
    // A file is created once and every later write reports that same moment,
    // so this is the file's age rather than the age of the bytes now in it.
    // Taken from the commit, which read it inside the write lock: asking the
    // realm again afterwards would be a second query for a value the lock
    // holder already had, against a row a concurrent removal of the same path
    // may by then have taken away — answering 204 with no `x-created` where
    // this route has always carried one.
    let created = result.meta.created;
    return createResponse({
      body: null,
      init: {
        status: 204,
        headers: {
          'last-modified': formatRFC7231(lastModified * 1000),
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
        },
      },
      requestContext,
    });
  }

  private assertWriteSize(
    content: WriteContent,
    type: 'card' | 'file',
    path: LocalPath,
  ) {
    let limit =
      type === 'card'
        ? this.#cardSizeLimitBytes
        : fileSizeLimitFor(path, {
            default: this.#fileSizeLimitBytes,
            audio: this.#audioSizeLimitBytes,
            video: this.#videoSizeLimitBytes,
          });
    try {
      // Described content reports its byte length without being read, which is
      // the whole point of it, so the ceiling is applied to that.
      if (isSplicedSource(content)) {
        validateByteLength(content.size, limit, type);
      } else {
        validateWriteSize(content, limit, type);
      }
    } catch (error: any) {
      throw new CardError(error?.message ?? 'Payload too large', {
        status: 413,
        title: 'Payload Too Large',
      });
    }
  }

  // The realm-relative target for a 302, built from a local path. A header
  // value is a ByteString, so a local path carrying anything outside Latin-1 —
  // an emoji in a file name, a CJK character — cannot go into `Location` as the
  // path spells it: `new Response` rejects the value outright with
  // `Cannot convert argument to a ByteString`. Resolving through `fileURL`
  // percent-encodes the path the same way the client's own URL was encoded on
  // the wire, so the header stays ASCII and `paths.local` recovers the same
  // file from it.
  //
  // The `./` prefix is what keeps that resolution path-relative, and it is not
  // optional. A bare local path whose first segment reads as a URL scheme is
  // otherwise parsed as an absolute or opaque URL, and everything up to and
  // including the colon — the realm's own mount path along with it — is dropped
  // from `pathname`: `notes:x.gts` yields `x.gts`, `https:x.gts` yields `/`,
  // and a name as ordinary as `re: notes.gts` yields ` notes.gts`, which a
  // header then trims to `notes.gts`. Each of those addresses a different file
  // than the one that was found. `./` cannot begin a scheme, so every name
  // resolves as a path under the realm.
  //
  // `pathname` (not `href`) keeps the target realm-relative, which is what a
  // client reaching the realm through a different published host needs.
  private redirectTarget(localPath: LocalPath): string {
    return this.paths.fileURL(`./${localPath}`).pathname;
  }

  private async getSourceOrRedirect(
    request: Request,
    requestContext: RequestContext,
  ): Promise<ResponseWithNodeStream> {
    let url = new URL(request.url);
    let bypassCache =
      url.searchParams.has('noCache') ||
      (!url.pathname.endsWith('.json') &&
        !hasExecutableExtension(url.pathname));
    let localName = this.paths.local(url);
    if (bypassCache) {
      let cachedEntry = this.#sourceCache.get(localName);
      if (cachedEntry) {
        this.#dropSourceCacheEntry(cachedEntry.canonicalPath);
      }
    } else {
      let cached = this.#sourceCache.get(localName);
      if (cached) {
        let start = Date.now();
        try {
          if (cached.type === 'redirect') {
            return createResponse({
              body: null,
              init: {
                status: cached.status,
                headers: {
                  ...cached.headers,
                  [CACHE_HEADER]: CACHE_HIT_VALUE,
                },
              },
              requestContext,
            });
          }
          return await this.serveLocalFile(
            request,
            cached.ref,
            requestContext,
            {
              defaultHeaders: {
                ...cached.defaultHeaders,
                [CACHE_HEADER]: CACHE_HIT_VALUE,
              },
              etagVariant: SOURCE_ETAG_VARIANT,
              etagBase: cached.contentHash,
            },
          );
        } finally {
          this.#logRequestPerformance(request, start, 'cache hit');
        }
      }
    }

    let start = Date.now();
    try {
      // Always try executable extension fallbacks so that dotted filenames
      // like "hello.test" resolve to "hello.test.gts". Only skip fallbacks
      // when the URL already has an executable extension.
      let alreadyHasExecutableExt = hasExecutableExtension(localName);
      let fallbackExtensions = alreadyHasExecutableExt
        ? []
        : [...executableExtensions, '.json'];
      // Snapshot the source-cache generation BEFORE the first await for every
      // candidate getFileWithFallbacks could resolve to. invalidateCache(path)
      // bumps the counter synchronously, so if it fires while we're reading
      // bytes from disk (getFileWithFallbacks + materializeFileRef + the
      // getCreatedTime query below) the post-read comparison against
      // handle.path's snapshotted gen catches the race and we skip the cache
      // write — otherwise the pre-invalidation bytes we just read would
      // re-fill the slot invalidate just cleared, serving a file that is
      // already gone from disk. bypassCache requests never set the cache, so
      // they need no snapshot.
      let sourceCacheGenSnapshot = bypassCache
        ? undefined
        : this.#snapshotSourceCacheGeneration(localName);
      let handle = await this.getFileWithFallbacks(
        localName,
        fallbackExtensions,
      );
      if (!handle) {
        return notFound(request, requestContext, `${localName} not found`);
      }

      if (handle.path !== localName) {
        if (alreadyHasExecutableExt) {
          return notFound(request, requestContext, `${localName} not found`);
        }
        let headers = {
          Location: this.redirectTarget(handle.path),
          [CACHE_HEADER]: CACHE_MISS_VALUE,
        };
        let response = createResponse({
          body: null,
          init: {
            status: 302,
            headers,
          },
          requestContext,
        });
        if (sourceCacheGenSnapshot) {
          if (
            !this.#sourceCacheGenerationChanged(
              handle.path,
              sourceCacheGenSnapshot,
            )
          ) {
            this.#sourceCache.set(localName, {
              type: 'redirect',
              status: 302,
              headers,
              canonicalPath: handle.path,
            });
          } else {
            this.#log.info(
              `Dropped stale #sourceCache redirect set for ${handle.path} (requested ${localName}) — invalidated during in-flight source read`,
            );
          }
        }
        return response;
      }

      // The bytes and everything describing them are the `readSource`
      // operation's from here down. What stays here is the response around
      // them: which validator this route builds, the 304, the source cache,
      // and the cache-status header — all of which are this route's own
      // choices rather than facts about the file.
      //
      // A `HEAD` asks for the metadata alone, but only where this route has no
      // use of its own for the bytes. Below, a cached read materializes them to
      // fill the source cache, and it fills it for a `HEAD` exactly as for a
      // `GET` — so the next `GET` of that path is served from cache either way,
      // which is what a client observes. Asking for a body there and dropping
      // it is the cost of leaving that alone.
      let headersOnly =
        request.method === 'HEAD' && bypassCache ? (true as const) : undefined;
      let source = await this.#readStoredSource(
        this.#callerOf(request, requestContext),
        handle.path,
        { headersOnly },
      );
      if (!source) {
        return notFound(request, requestContext, `${localName} not found`);
      }
      let served = this.#servableSource(handle, source);
      let defaultHeaders: Record<string, string> = {
        'content-type': source.contentType,
        ...(source.created != null
          ? { 'x-created': formatRFC7231(source.created * 1000) }
          : {}),
        [CACHE_HEADER]: CACHE_MISS_VALUE,
      };
      if (bypassCache) {
        return await this.serveLocalFile(request, served, requestContext, {
          defaultHeaders,
          etagVariant: SOURCE_ETAG_VARIANT,
          createdAt: source.created,
        });
      } else {
        let cachedRef = await this.materializeFileRef(served);
        // Test-only gate: park here (bytes read, cache not yet written) so the
        // source-cache race test can fire invalidateCache before the set.
        if (this.#testOnlySourceCacheDelay) {
          await this.#testOnlySourceCacheDelay();
        }
        // Compute the content fingerprint while we have the body in
        // memory — `cachedRef.content` is already a string/Uint8Array
        // post-materialization, so this is a single hash with no extra I/O.
        //
        // The read reports a `version` for the same bytes, and this does not
        // use it. The two are the same fingerprint of the same content, but
        // they are reached differently: `version` prefers the hash the realm
        // recorded at write time, which describes the file only while nothing
        // has overwritten it out of band at its exact length. This value is
        // hashed from the bytes about to be cached and sent, so the validator
        // always describes what it is attached to. Which identity this route
        // validates on is the route's to choose, and choosing the recorded one
        // is a change to what a conditional request compares rather than a
        // consequence of where the bytes now come from.
        let contentHash = contentHashFromMaterializedRef(cachedRef);
        if (
          sourceCacheGenSnapshot &&
          !this.#sourceCacheGenerationChanged(
            handle.path,
            sourceCacheGenSnapshot,
          )
        ) {
          this.#sourceCache.set(localName, {
            type: 'file',
            ref: cachedRef,
            defaultHeaders,
            canonicalPath: handle.path,
            contentHash,
          });
        } else if (sourceCacheGenSnapshot) {
          this.#log.info(
            `Dropped stale #sourceCache set for ${handle.path} — invalidated during in-flight source read`,
          );
        }
        return await this.serveLocalFile(request, cachedRef, requestContext, {
          defaultHeaders,
          etagVariant: SOURCE_ETAG_VARIANT,
          etagBase: contentHash,
          createdAt: source.created,
        });
      }
    } finally {
      this.#logRequestPerformance(request, start, 'cache miss');
    }
  }

  private async removeCardSource(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Source-content-type callers, by definition, don't depend on indexed
    // state — symmetric with upsertCardSource. Return as soon as the file
    // is gone from disk; indexing happens async and surfaces errors via
    // error_doc as before. Subscribers to indexing events still see the
    // broadcast once the worker settles.
    let localName = this.paths.local(new URL(request.url));
    let handle = await this.getFileWithFallbacks(localName, [
      ...executableExtensions,
      '.json',
    ]);
    if (!handle) {
      return notFound(request, requestContext, `${localName} not found`);
    }
    await this.delete(handle.path, {
      waitForIndex: false,
      initiatingUser: requestContext.authenticatedUser ?? null,
    });
    return createResponse({
      body: null,
      init: { status: 204 },
      requestContext,
    });
  }

  // we bother with this because typescript is picky about allowing you to use
  // explicit file extensions in your source code
  private async getFileWithFallbacks(
    path: LocalPath,
    fallbackExtensions: string[] = [],
  ): Promise<FileRef | undefined> {
    return getFileWithFallbacks(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      fallbackExtensions,
    );
  }

  private cloneFileRefWithContent(
    ref: FileRef,
    content: string | Uint8Array,
  ): FileRef {
    let clone: FileRef = {
      path: ref.path,
      content,
      lastModified: ref.lastModified,
    };
    for (let symbol of Object.getOwnPropertySymbols(ref)) {
      (clone as any)[symbol] = (ref as any)[symbol];
    }
    return clone;
  }

  private async materializeFileRef(ref: FileRef): Promise<FileRef> {
    let content = ref.content;
    if (typeof content === 'string') {
      return this.cloneFileRefWithContent(ref, content);
    }
    if (content instanceof Uint8Array) {
      return this.cloneFileRefWithContent(ref, content);
    }
    if (
      typeof ReadableStream !== 'undefined' &&
      content instanceof ReadableStream
    ) {
      let text = await fileContentToText({ content });
      return this.cloneFileRefWithContent(ref, text);
    }
    if (isNode && typeof (content as any)?.pipe === 'function') {
      let text = await fileContentToText({ content } as Pick<
        FileRef,
        'content'
      >);
      return this.cloneFileRefWithContent(ref, text);
    }
    let text = await fileContentToText(ref);
    return this.cloneFileRefWithContent(ref, text);
  }

  private async handleExecutableInvalidations(
    invalidatedURLs: URL[],
  ): Promise<void> {
    let definitionInvalidations: Promise<string[]>[] = [];
    let changedDependencyKeys = new Set<string>();
    for (const invalidatedURL of invalidatedURLs) {
      if (hasExecutableExtension(invalidatedURL.href)) {
        let invalidatedPath = this.paths.local(invalidatedURL);
        this.#dropTranspiledModuleEntry(invalidatedPath);
        changedDependencyKeys.add(moduleDependencyKey(invalidatedPath));
        definitionInvalidations.push(
          this.#definitionLookup.invalidate(invalidatedURL.href),
        );
      }
    }
    for (let invalidatedModuleURLs of await Promise.all(
      definitionInvalidations,
    )) {
      for (let invalidatedModuleURL of invalidatedModuleURLs) {
        try {
          let invalidatedPath = this.paths.local(new URL(invalidatedModuleURL));
          this.#dropTranspiledModuleEntry(invalidatedPath);
          changedDependencyKeys.add(moduleDependencyKey(invalidatedPath));
        } catch (_err) {
          // ignore invalidations outside this realm
        }
      }
    }
    let dependentInvalidations = collectDependentModuleCacheInvalidations(
      changedDependencyKeys,
      this.transpiledModuleDependencyEntries(),
    );
    for (let invalidatedPath of dependentInvalidations) {
      this.#dropTranspiledModuleEntry(invalidatedPath);
    }
  }

  private *transpiledModuleDependencyEntries() {
    for (let [, cachedEntry] of this.#transpiledModuleCache.entries()) {
      yield {
        canonicalPath: cachedEntry.canonicalPath,
        dependencyKeys: cachedEntry.dependencyKeys,
      };
    }
  }

  private async openFileForMetadata(
    localPath: LocalPath,
  ): Promise<FileRef | undefined> {
    if (!localPath || localPath.startsWith('_')) {
      return undefined;
    }
    if (localPath.endsWith('.json')) {
      return undefined;
    }
    return this.#adapter.openFile(localPath);
  }

  // The stored bytes at a local path, as the operation core opens them.
  //
  // Neither of `openFileForMetadata`'s two name-based refusals applies here.
  // Its `.json` refusal is right for metadata — a `.json` is a card's source,
  // not a file with metadata of its own — and wrong for this, because a card's
  // stored source is exactly what a stored-bytes read reads. Its `_`-prefix
  // refusal does not describe the byte routes: the `card+source` GET/HEAD is
  // registered on `/.*` and refuses no name, the raw byte serve is whatever
  // `fallbackHandle` reaches when the router does not claim the request, and
  // `upsertCardSource` writes whatever path it is given. So an `_`-prefixed
  // file a caller stored is a file those routes serve, and refusing it here
  // would make this the one read that could not reach it.
  //
  // The prefixes the router or `handle` do claim are the exception in the
  // other direction: a path under one is answered by that endpoint rather than
  // from disk, so bytes stored beneath it — `_screenshot/…`, say, whose GET is
  // claimed before the router — are reachable through this read and through no
  // byte route. Worth knowing when a facade routes here; not worth a
  // name-based refusal, which is what got this wrong in the first place.
  //
  // What is left is the path that names no file at all. `#adapter.openFile`
  // answers undefined for a directory and for a path that is not there, so
  // every way there is nothing to read arrives at the core the same way.
  async #operationStoredFile(
    localPath: LocalPath,
  ): Promise<FileRef | undefined> {
    if (!localPath) {
      return undefined;
    }
    return await this.#adapter.openFile(localPath);
  }

  private async nonJsonFileExists(localPath: LocalPath): Promise<boolean> {
    if (localPath?.endsWith('.json')) {
      localPath = localPath.slice(0, -5);
    }
    // Treat the path as JSON-backed if a sibling .json file exists.
    if (await this.#adapter.exists(`${localPath}.json`)) {
      return false;
    }
    return await this.#adapter.exists(localPath);
  }

  // The index has no row for `localPath`, so there is no card document to
  // serve. Which 404 that is depends on the source file: a write lands on the
  // realm's file system first and is indexed after, so a card whose `.json` is
  // already on disk is one this realm has not caught up with rather than one
  // that does not exist. `notIndexedYet` says so, letting a caller hold a
  // placeholder until the realm broadcasts the index event for it. A read
  // served by the replica that took the write rarely gets here — that path
  // drains its own in-flight indexing first — but a read served by any other
  // replica has no such handle on the write.
  private async missingInstanceResponse(
    request: Request,
    requestContext: RequestContext,
    localPath: LocalPath,
  ): Promise<Response> {
    let sourcePath = `${localPath}.json` as LocalPath;
    if (await this.isIgnored(this.paths.fileURL(sourcePath))) {
      // An ignored path is never visited, so no amount of waiting produces an
      // index row for it.
      return notFound(request, requestContext);
    }
    let source = await this.readFileAsText(sourcePath);
    if (!source) {
      return notFound(request, requestContext);
    }
    // The marker promises an index row is coming, so it has to match what the
    // indexer will actually make one for: a `.json` whose `data` is a single
    // card resource. A collection document (which `isCardDocumentString` also
    // accepts) never becomes an instance row, and neither does anything else
    // — those are genuinely not cards, not cards in waiting.
    let parsed: unknown;
    try {
      parsed = JSON.parse(source.content);
    } catch {
      return notFound(request, requestContext);
    }
    if (!isSingleCardDocument(parsed)) {
      return notFound(request, requestContext);
    }
    return notIndexedYet(request, requestContext);
  }

  private async fileMetaDocument(
    requestContext: RequestContext,
    localPath: LocalPath,
    contentType: SupportedMimeType = SupportedMimeType.CardJson,
  ): Promise<Response | undefined> {
    let doc = await this.#fileMetaDocumentFromDisk(localPath);
    if (!doc) {
      return undefined;
    }
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: {
          'content-type': contentType,
        },
      },
      requestContext,
    });
  }

  // A file's metadata document read from the bytes on disk — the answer for a
  // file the index has no row for. Content-derived values come from the
  // write-time record where there is one and are computed from the bytes
  // otherwise.
  async #fileMetaDocumentFromDisk(
    localPath: LocalPath,
  ): Promise<SingleFileMetaDocument | undefined> {
    let fileRef = await this.openFileForMetadata(localPath);
    if (!fileRef) {
      return undefined;
    }
    let fileURL = this.paths.fileURL(localPath).href;
    let fileDefCodeRef = resolveFileDefCodeRef(
      new URL(fileURL),
      this.#virtualNetwork,
    );
    let name = localPath.split('/').pop() ?? localPath;
    let inferredContentType = inferContentType(name);
    let createdAt = await this.getCreatedTime(localPath);
    let { info: realmInfo } = await this.parseRealmInfo();
    let persistedMeta = this.#dbAdapter
      ? await getContentMeta(this.#dbAdapter, this.url, localPath)
      : { contentHash: undefined, contentSize: undefined };
    let contentHash =
      persistedMeta.contentHash ?? (await computeContentHashFromRef(fileRef));
    let contentSize =
      persistedMeta.contentSize ?? (await computeContentSizeFromRef(fileRef));
    let doc: SingleFileMetaDocument = {
      data: {
        type: 'file-meta',
        id: fileURL as RealmResourceIdentifier,
        attributes: {
          name,
          url: fileURL,
          sourceUrl: fileURL,
          contentType: inferredContentType,
          contentHash,
          contentSize,
          lastModified: fileRef.lastModified,
          createdAt: createdAt ?? fileRef.lastModified,
        },
        meta: {
          adoptsFrom: fileDefCodeRef,
          realmInfo,
          realmURL: this.url as RealmIdentifier,
          // This un-indexed fallback must stamp the timestamps too, so a file's
          // `meta` timestamps don't hinge on whether the row is in the index yet.
          ...fileMetaTimestamps(
            fileRef.lastModified,
            createdAt ?? fileRef.lastModified,
          ),
        },
        links: { self: fileURL },
      },
    };
    this.#serveInstanceIdsAsRRI(doc);
    return doc;
  }

  private async fileMetaDocumentFromIndex(
    requestContext: RequestContext,
    localPath: LocalPath,
    fileEntry: IndexedFile,
  ): Promise<Response> {
    let fileURL = this.paths.fileURL(localPath).href;
    let name = localPath.split('/').pop() ?? localPath;
    let inferredContentType = inferContentType(name);
    let createdAt = fileEntry.resourceCreatedAt ?? fileEntry.lastModified;
    let { info: realmInfo } = await this.parseRealmInfo();
    let searchDoc = fileEntry.searchDoc ?? {};
    let searchHash =
      typeof searchDoc.contentHash === 'string'
        ? searchDoc.contentHash
        : undefined;
    let searchSize =
      typeof searchDoc.contentSize === 'number'
        ? searchDoc.contentSize
        : undefined;
    // `realm_file_meta` is written in the same critical section as the file's
    // bytes, so it is authoritative for content-derived values. It is
    // preferred over the indexed values, which lag one batch promotion behind:
    // a render inside the batch that re-indexes this file reads the pre-swap
    // production row, so a card linking the file sees the file's index row at
    // its previous contentHash/contentSize. The indexed values remain as
    // fallbacks for files whose bytes were never hashed at write time.
    let persistedMeta = this.#dbAdapter
      ? await getContentMeta(this.#dbAdapter, this.url, localPath)
      : { contentHash: undefined, contentSize: undefined };
    let contentHash = persistedMeta.contentHash ?? searchHash;
    let contentSize = persistedMeta.contentSize ?? searchSize;
    let adoptsFrom =
      codeRefFromInternalKey(fileEntry.types?.[0]) ??
      (isCodeRef(fileEntry.resource?.meta?.adoptsFrom)
        ? fileEntry.resource?.meta?.adoptsFrom
        : resolveFileDefCodeRef(new URL(fileURL), this.#virtualNetwork));
    let resourceAttributes =
      (fileEntry as IndexedFile).resource?.attributes ?? {};
    let baseAttributes = {
      name: resourceAttributes.name ?? searchDoc.name ?? name,
      url: resourceAttributes.url ?? searchDoc.url ?? fileURL,
      sourceUrl: resourceAttributes.sourceUrl ?? searchDoc.sourceUrl ?? fileURL,
      contentType:
        resourceAttributes.contentType ??
        searchDoc.contentType ??
        inferredContentType,
      // The persisted write-time values win over the indexed resource's for
      // the same staleness reason as above; the resource's extract-computed
      // values cover files that predate write-time hashing.
      contentHash: contentHash ?? resourceAttributes.contentHash,
      contentSize: contentSize ?? resourceAttributes.contentSize,
      lastModified: fileEntry.lastModified ?? unixTime(Date.now()),
      createdAt: createdAt ?? unixTime(Date.now()),
    };
    let attributes: Record<string, unknown> = { ...baseAttributes };
    for (let [key, value] of Object.entries(resourceAttributes)) {
      if (value !== undefined && !(key in attributes)) {
        attributes[key] = value;
      }
    }
    for (let [key, value] of Object.entries(searchDoc)) {
      if (FILE_META_RESERVED_KEYS.has(key) || key in attributes) {
        continue;
      }
      if (value !== undefined) {
        attributes[key] = value;
      }
    }
    let doc: SingleFileMetaDocument = {
      data: {
        type: 'file-meta',
        id: fileURL as RealmResourceIdentifier,
        attributes: {
          ...attributes,
        },
        meta: {
          adoptsFrom,
          realmInfo,
          realmURL: this.url as RealmIdentifier,
          ...fileMetaTimestamps(
            baseAttributes.lastModified,
            baseAttributes.createdAt,
          ),
          // Per-field subclass overrides for nested polymorphic fields (e.g.
          // `frontmatter` → SkillFrontmatterField). Without this the field
          // rehydrates as its declared base type when the document is read.
          ...(fileEntry.resource?.meta?.fields
            ? { fields: fileEntry.resource.meta.fields }
            : {}),
          ...(fileEntry.resource?.meta?.queryFieldDefs
            ? { queryFieldDefs: fileEntry.resource.meta.queryFieldDefs }
            : {}),
          // The file row's declared-screenshot manifest, joined at serve time
          // the way the card+json GET joins an instance row's — never
          // persisted into the index row's resource itself.
          ...(fileEntry.screenshots
            ? {
                screenshots: screenshotsMetaFromManifest(
                  fileEntry.screenshots,
                  {
                    realmURL: this.url,
                    instanceLocalPath: localPath,
                  },
                ),
              }
            : {}),
        },
        links: { self: fileURL },
      },
    };
    this.#serveInstanceIdsAsRRI(doc);
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: {
          'content-type': SupportedMimeType.FileMeta,
        },
      },
      requestContext,
    });
  }

  // The file-meta document for a path that holds bytes rather than a card, as
  // the operation core reads it — the card+json read's own answer for such a
  // path, derived from the bytes, with no response around it. The guard is the
  // one that read applies: a path whose sibling `.json` makes it a card's
  // source is not a file, and answers undefined so the read falls back to its
  // own not-found handling.
  async #operationFileMetaDocument(
    localPath: LocalPath,
  ): Promise<SingleFileMetaDocument | undefined> {
    if (!(await this.nonJsonFileExists(localPath))) {
      return undefined;
    }
    return await this.#fileMetaDocumentFromDisk(localPath);
  }

  // The write-time record behind a path's bytes: the content hash a
  // stored-bytes read reports as `version`, and when the realm first saw the
  // path.
  //
  // `version` has one job — to identify the bytes it is returned alongside —
  // and the persisted row only does that job while it describes the file on
  // disk. `persistFileMeta` is reached from the realm's own write path and
  // nowhere else, so a file overwritten out of band (a deploy rsync, an
  // operator editing the volume) keeps a row describing bytes that are gone.
  // Handing that hash back would be worse than computing one: it is what a
  // conditional GET builds its validator from, so a stale one answers 304 for
  // content that changed.
  //
  // So the row is trusted only where the length it recorded matches the handle
  // the caller is reading from — that handle's `size`, taken from the
  // adapter's stat rather than from its bytes — and the fingerprint is read
  // from the file otherwise, in the bounded ranges `contentHashFromRanges`
  // describes. An out-of-band overwrite that preserves the exact byte length
  // is the one case the length check does not catch; closing it needs an mtime
  // on the row to validate against, and whether the byte facade wants that is
  // its call to make.
  //
  // Every path is fingerprinted, an image or a video included. Which validator
  // a byte route builds is that route's own choice — `getSourceOrRedirect`
  // rests its `ETag` on a content hash for a `.json` or an executable
  // extension and on `lastModified` for everything else — but the read that
  // produces a hash is bounded, so declining to answer for the paths one route
  // happens not to ask about would withhold a content identity rather than
  // save anything worth saving.
  //
  // Both values come from one row, so this is one query on
  // `realm_file_meta`'s primary key rather than a lookup per value — worth
  // holding to, since a byte response routed through here pays it per request.
  async #operationStoredFileMeta(
    localPath: LocalPath,
    file: OperationStoredFile,
    opts?: { skipContentFingerprint?: boolean },
  ): Promise<OperationStoredFileMeta> {
    let persisted = this.#dbAdapter
      ? (await getFileMetaForPaths(this.#dbAdapter, this.url, [localPath])).get(
          localPath,
        )
      : undefined;
    let createdAt = persisted?.createdAt;
    if (
      persisted?.contentHash !== undefined &&
      file.size !== undefined &&
      persisted.contentSize === file.size
    ) {
      return { version: persisted.contentHash, createdAt };
    }
    if (opts?.skipContentFingerprint) {
      // The row holds no hash this handle's size vouches for, and the caller
      // validates on something other than `version` — so the read that would
      // produce one buys nothing. It is the expensive half of this method:
      // `persistFileMeta` records a hash only for a path written through the
      // realm's own write API, so a deployed or seeded file reaches here every
      // time, and the read is bounded per request rather than amortized.
      return { createdAt };
    }
    return { version: await contentHashFromRanges(file), createdAt };
  }

  private async getFileMeta(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (localPath === '') {
      localPath = 'index';
    }
    let fileEntry = await this.#realmIndexQueryEngine.file(
      this.paths.fileURL(localPath),
    );
    if (fileEntry) {
      return await this.fileMetaDocumentFromIndex(
        requestContext,
        localPath,
        fileEntry,
      );
    }
    let fileResponse = await this.fileMetaDocument(
      requestContext,
      localPath,
      SupportedMimeType.FileMeta,
    );
    if (fileResponse) {
      return fileResponse;
    }
    return notFound(request, requestContext);
  }

  // One `realm:write-timing` line per card write, emitted from a `finally` so
  // a write that failed is attributed too — that is the write whose time
  // someone is most likely trying to account for.
  //
  // A request that was refused before it reached the commit — an unsupported
  // media type, a path the verb does not serve, a body that is not a card —
  // stamped no stage, and a line for it would say only how long it took to
  // say no. Those are skipped, so every line on this channel describes a
  // request that tried to write.
  //
  // `status` is the answer the write gave: the response's own code, or
  // `failed` where it threw instead of answering. A write that did not finish
  // leaves the stage it was in unclosed, and its elapsed time lands in the
  // residual rather than in the stage that was running — which is the honest
  // reading, since a `persist` that threw partway is not a persist. That only
  // works if the line says the write did not succeed, so this is what makes
  // the residual legible rather than misleading.
  #emitWriteTiming(
    method: string,
    request: Request,
    startedAt: number,
    timings: RequestTimings,
    status: string,
  ): void {
    let stages = timings.toLogFragment();
    if (!stages) {
      return;
    }
    let correlationId = sanitizeLoggingCorrelationId(
      request.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
    );
    emitWriteTiming(
      `${method} ${request.url}` +
        (correlationId ? ` corr=${correlationId}` : '') +
        ` status=${status}` +
        ` handler=${Date.now() - startedAt}ms ` +
        stages,
    );
  }

  private async createCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let timings = new RequestTimings();
    let startedAt = Date.now();
    // Set from the response, so a refusal the handler answers with is reported
    // as the code it sent; left as `failed` when it threw and sent nothing.
    let status = 'failed';
    try {
      let response = await this.#createCard(request, requestContext, timings);
      status = String(response.status);
      return response;
    } finally {
      this.#emitWriteTiming('POST', request, startedAt, timings, status);
    }
  }

  async #createCard(
    request: Request,
    requestContext: RequestContext,
    timings: RequestTimings,
  ): Promise<Response> {
    let duringPrerender = isDuringPrerenderRequest(request);
    // A skip-index-wait caller (see SKIP_INDEX_WAIT_HEADER) gets the same
    // write-side treatment as a prerender write: index deferred, answer from
    // the serialized echo. `answerFromEcho` gates exactly those two decisions
    // (whether the batch waits for indexing, and whether the new card is read
    // back out of the index or echoed) and nothing prerender-specific beyond
    // them.
    let answerFromEcho = duringPrerender || isSkipIndexWaitRequest(request);
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return badRequest({
        message: `Request body is not valid card JSON-API`,
        requestContext,
      });
    }
    let { data: primaryResource, included: maybeIncluded } = json;
    if (!isCardResource(primaryResource)) {
      return badRequest({
        message: `Request body is not valid card JSON-API`,
        requestContext,
      });
    }
    if (maybeIncluded) {
      if (!Array.isArray(maybeIncluded)) {
        return badRequest({
          message: `Request body is not valid card JSON-API: included is not array`,
          requestContext,
        });
      }
      for (let sideLoadedResource of maybeIncluded) {
        if (!isCardResource(sideLoadedResource)) {
          return badRequest({
            message: `Request body is not valid card JSON-API: side-loaded data is not a valid card resource`,
            requestContext,
          });
        }
      }
    }
    let lid =
      typeof primaryResource.lid === 'string' ? primaryResource.lid : undefined;
    let result: BatchEntryResult;
    try {
      result = (
        await commitBatch(
          this.batchCore,
          [
            {
              // One entry, carrying its side-loads. A `POST` with `included`
              // is already a multi-card write, and a create stages the primary
              // together with every side-load that named itself with a `lid`,
              // under the one index job and the one index event this request
              // has always produced.
              op: 'create',
              document: {
                data: primaryResource,
                ...(maybeIncluded ? { included: maybeIncluded } : {}),
              },
              // Where the `POST` was aimed — the realm root, or a directory
              // under it. The card's type directory is named beneath that, and
              // the file beneath that.
              directory: this.paths.local(new URL(request.url)),
            },
          ],
          {
            clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
            ...(requestContext.authenticatedUser
              ? { actor: requestContext.authenticatedUser }
              : {}),
            // Waiting decides two things and an echoing caller wants neither:
            // the batch drains indexing already in flight before it stages,
            // and it returns only once its own index job has landed. A
            // prerender-originated write MUST NOT wait — the job it would wait
            // on needs the render slot, and on the queued-command path the
            // worker, that this caller is holding, so waiting deadlocks — and
            // it has nothing to read back either, since it answers from what
            // it wrote. Skipping the drain costs the write nothing: serializing
            // a card resolves its type through `lookupDefinition`, which reads
            // the module off disk rather than out of the index, and the commit
            // drops a rewritten module's cached definition as it writes the
            // bytes.
            ...(answerFromEcho ? { waitForIndex: false } : {}),
            reportStoredContent: answerFromEcho,
            // A side-load claiming another realm is not this realm's to
            // create, and a `POST` carrying one has always stored the card
            // with that edge empty rather than refusing the write.
            foreignSideLoadLink: 'leave',
            timings,
          },
        )
      )[0];
    } catch (err: unknown) {
      return this.#cardWriteRefusal(err, request, requestContext, { lid });
    }
    let lastModified = result?.meta.lastModified;
    if (result == null || lastModified == null) {
      // The commit reports a modification time for every file it writes, so
      // reaching here means the card did not land as one. Said out loud rather
      // than defaulted, since a default would answer 201 for a card the realm
      // may not be holding.
      return systemError({
        requestContext,
        message: `unable to determine the card created from the request payload`,
        lid,
      });
    }
    let created = result.meta.created;
    let newURL = result.id;
    let doc: SingleCardDocument;
    if (answerFromEcho) {
      // See serializedInstanceEcho: the write indexed deferred, so there is
      // nothing to read back yet. The document is the one the commit stored,
      // reported by the batch rather than read back off the file — which has
      // been open to every other writer since the commit released the lock.
      let stored = storedCardDocument(result);
      if (!stored) {
        return systemError({
          requestContext,
          message: `Unable to report newly created card: ${newURL}, the commit reported no stored document`,
          id: newURL,
          lid,
        });
      }
      doc = await this.serializedInstanceEcho(stored, newURL, lastModified);
    } else {
      // The readback asks for the written card and nothing around it: no
      // `loadLinks`, so neither the transitive closure of the card's links nor
      // the query a query-backed field would run to name its targets.
      //
      // Nothing consumes either. Two surfaces in the host see a write
      // response, and neither reads the link graph. The one that updates the
      // instance drops `data.attributes` and `data.relationships` before
      // merging, which leaves `included[]` unreachable; the save subscriber
      // gets the body whole, and exists for tests. A card created by `lid`
      // under this write is reconciled to its assigned id from the realm
      // invalidation event, which correlates the last segment of the assigned
      // URL with the local id (`tryFindingCardItem` in the host's card store
      // names that as the reconciliation point, alongside `api.setId`); the
      // response document is not part of that path, and could not be — the
      // index answers in ids, never in the `lid` a caller would match on.
      // Writes that answer from the serialized echo — prerender and
      // skip-index-wait callers — return no `included` at all and always have.
      let entry = await timings.time('readback', () =>
        this.#realmIndexQueryEngine.cardDocument(new URL(newURL)),
      );
      if (!entry || entry?.type === 'error') {
        let err = entry
          ? CardError.fromSerializableError(entry.error)
          : undefined;
        return systemError({
          requestContext,
          message: `Unable to index newly created card: ${newURL}, can't find new instance in index`,
          additionalError: err,
          id: newURL,
        });
      }
      doc = merge({}, entry.doc, {
        data: {
          links: { self: newURL },
          meta: { lastModified },
        },
      });
    }
    this.#serveInstanceIdsAsRRI(doc);
    // The last sequential leg: turning the assembled document into the bytes
    // that go on the wire. Stamped because it scales with the body, which is
    // what the shape of this response decides.
    let responseBody = await timings.time('stringify', async () =>
      JSON.stringify(doc, null, 2),
    );
    return createResponse({
      body: responseBody,
      init: {
        status: 201,
        headers: {
          'content-type': SupportedMimeType.CardJson,
          ...lastModifiedHeader(doc),
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
        },
      },
      requestContext,
    });
  }

  // A conditional write's precondition: throws a 412 when the card is no
  // longer the one the caller saw, and returns for a request that may
  // proceed. Handed to `commitBatch` rather than called before it, because it
  // is only binding inside the locks the write takes — a check made before
  // them can pass and then queue behind another writer's whole write of the
  // same card, which is exactly the contended case the header exists for. The coordinator runs it after
  // its drain and before anything is staged, so a refusal writes nothing,
  // enqueues nothing and broadcasts nothing; the drain is the coordinator's,
  // so a caller that must not wait on indexing still does not.
  //
  // The comparand is the card's `ETag` — the same validator a `GET` of it
  // hands out and an `If-None-Match` is checked against. That is what an HTTP
  // conditional request names, and it is the validator a client actually
  // holds, since it is the only one a read gives out.
  //
  // It is the broader of the realm's two fingerprints and the later of them.
  // Broader because it moves whenever the served document may differ, a
  // linked card's re-index included, where the stored file's hash moves only
  // when this card's own bytes do. Later because it is built from
  // `indexed_at`, which moves after the bytes rather than with them — which
  // is why running inside the lock, after the drain, is what makes it mean
  // anything.
  //
  // That breadth is also where the guarantee stops, because the lock is
  // narrower than the validator. A write locks the files it names, so no
  // other writer can move this card's bytes between the check and the commit
  // — which is the lost update the header exists to prevent. A linked card's
  // re-index moves this validator without touching this file, and that write
  // takes a different lock, so a conditional write can still commit against a
  // validator that went stale while it ran. That is the trade rather than a
  // hole: what is on offer is that this card is still the one the caller
  // edited, not that everything its document is assembled from is unchanged.
  // A caller that needs the second has no validator to ask for it with, since
  // the served document is the only thing either fingerprint describes.
  //
  // Comparison is `ifNoneMatchMatches`': `*`, comma lists, and the `W/` prefix
  // ignored on both sides. RFC 9110 §13.1.1 asks for strong comparison here
  // where §13.1.2 allows weak, but the realm emits no weak validators, so the
  // two rules differ only over a validator no response of ours produced.
  //
  // `*` asks only that a card be there, which is what the handler settles
  // itself — an absent one gets the 404 it always would, which says more than
  // a 412 does. A concrete validator has to match one, so a card the realm
  // can offer no validator for — never indexed, or an `ETag` suppressed
  // because the document depends on another realm — fails the precondition:
  // "this is the card you saw" is a claim the realm cannot make.
  #conditionalWrite(
    request: Request,
    url: URL,
  ): (() => Promise<void>) | undefined {
    let ifMatch = request.headers.get('if-match');
    if (!ifMatch || ifMatch.trim() === '*') {
      return undefined;
    }
    let refuse = (): never => {
      throw new OperationFailure({
        id: url.href,
        status: 412,
        code: 'version-conflict',
        title: 'Precondition Failed',
        detail:
          `${request.method} of ${url.href} requires the card to match ` +
          `If-Match: ${ifMatch}, and it does not`,
      });
    };
    return async () => {
      // The validator is built from the index, and the index lags the bytes:
      // a commit records a file's hash before it indexes, and a write that
      // deferred its indexing releases the lock without having indexed at all.
      // The lock this runs inside stops another writer landing bytes, but says
      // nothing about indexing already in flight — and the realm's local view
      // of that is an in-memory map of the jobs *this* process enqueued, so a
      // peer replica's pending job is invisible to it. The realm's indexing
      // lane in the shared jobs table is the view every replica writes to.
      //
      // Scoped to the jobs that can leave a row describing bytes the realm no
      // longer stores, which is the only staleness a validator comparison can
      // be wrong about. Asking whether the lane is occupied at all would be
      // fail-closed and wrong in practice: a from-scratch pass re-derives rows
      // from files nobody changed, and one lands in every realm's lane after
      // any deploy that moves the UI checksum, so conditional writes would be
      // refused fleet-wide for the length of a reindex to guard against a
      // content change that did not happen. A daily stylesheet GC shares the
      // lane too and moves no row at all.
      //
      // Refusing when the lane will not settle is the point of checking at
      // all: an unsettled lane is exactly the state in which the row still
      // describes the pre-write card, so a validator the caller has been
      // overtaken by would match. Answering from it would turn the congestion
      // this guards against into a silent accept — and silently, since a lane
      // that never drains looks from here like a realm with nothing to
      // refuse. The refusal is a 5xx rather than a 412 because nothing about
      // the caller's request is wrong and repeating it is the remedy.
      if (this.#dbAdapter) {
        let settled = await awaitRealmIndexSettled(this.#dbAdapter, this.url, {
          jobTypes: CONTENT_MOVING_INDEX_JOB_TYPES,
          timeoutMs: CONDITIONAL_WRITE_INDEX_SETTLE_BUDGET_MS,
          pollIntervalMs: CONDITIONAL_WRITE_INDEX_SETTLE_POLL_MS,
        });
        if (!settled) {
          this.#log.warn(
            `conditional ${request.method} of ${url.href} refused: ` +
              `${indexingConcurrencyGroup(this.url)} did not settle, so the ` +
              `index cannot be compared against`,
          );
          throw new OperationFailure({
            id: url.href,
            status: 503,
            code: 'precondition-unverifiable',
            title: 'Service Unavailable',
            detail:
              `the realm could not establish that its index is current for ` +
              `${url.href}, so it cannot decide whether the card still ` +
              `matches If-Match: ${ifMatch}`,
          });
        }
      }
      await this.getRealmInfo();
      let entry = await this.#realmIndexQueryEngine.instance(url, {
        includeErrors: true,
      });
      if (entry?.type !== 'instance' || this.hasForeignRealmDeps(entry.deps)) {
        refuse();
      }
      // Every validator the realm would hand out for this card as it stands,
      // built by enumerating the builder's own arguments rather than the
      // spellings they produce — the shape, and the assembly-budget split the
      // `full` shape carries. Combinations that collapse to one validator are
      // deduplicated by the set rather than reasoned about, so a further
      // *enumerable* argument is covered here by adding it to the product.
      //
      // Nothing makes that automatic, and it is worth knowing why rather than
      // assuming a guard is missing: a new argument here arrives optional with
      // a default, which by construction does not break an existing call, so
      // there is no signature change for a type check to catch. The product
      // below is the only thing that knows this list has to grow.
      //
      // It does not cover a *value* folded into a variant, and one is: the
      // bounded `full` spelling interpolates the assembled-resource budget, so
      // only the budget this process is running with is built. That is uniform
      // across a deployment today — the value is read at module load — so it
      // bites only across a rolling deploy that retunes it, where a validator
      // issued by an old replica is refused by a new one. If that budget ever
      // varies per request, the number has to come out of the validator, or
      // every conditional write starts deciding partly on a server setting,
      // which is the failure enumerating the arguments is here to avoid. The shapes exist so a client holding one
      // representation is not 304'd to another, which makes them a fact about
      // representations — and this question is about the card. All of them
      // describe the same card at the same `indexed_at`, so refusing over
      // which shape a preceding read happened to answer in would refuse on a
      // server setting, or on whether the caller's last read was a write
      // echo, rather than on anything the caller did.
      let realmInfoHash = this.getCachedRealmInfoHash();
      let screenshots = screenshotsEtagFingerprint(entry!.screenshots);
      let issued = new Set(
        CARD_JSON_SHAPES.flatMap((shape) =>
          [false, true].map((unboundedAssembly) =>
            buildCardJsonEtag(
              entry!.indexedAt,
              realmInfoHash,
              screenshots,
              shape,
              unboundedAssembly,
            ),
          ),
        ),
      );
      if (
        ![...issued].some((etag) => etag && ifNoneMatchMatches(ifMatch, etag))
      ) {
        refuse();
      }
    };
  }

  private async patchCardInstance(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let timings = new RequestTimings();
    let startedAt = Date.now();
    // Set from the response, so a refusal the handler answers with is reported
    // as the code it sent; left as `failed` when it threw and sent nothing.
    let status = 'failed';
    try {
      let response = await this.#patchCardInstance(
        request,
        requestContext,
        timings,
      );
      status = String(response.status);
      return response;
    } finally {
      this.#emitWriteTiming('PATCH', request, startedAt, timings, status);
    }
  }

  async #patchCardInstance(
    request: Request,
    requestContext: RequestContext,
    timings: RequestTimings,
  ): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (await this.nonJsonFileExists(localPath)) {
      return unsupportedMediaType(request, requestContext);
    }
    if (localPath.startsWith('_')) {
      return methodNotAllowed(request, requestContext);
    }
    if (await this.openFileForMetadata(localPath)) {
      return methodNotAllowed(request, requestContext);
    }

    let url = this.paths.fileURL(localPath);
    let instanceURL = url.href.replace(/\.json$/, '');
    let duringPrerender = isDuringPrerenderRequest(request);
    // A skip-index-wait caller (see SKIP_INDEX_WAIT_HEADER) takes the same
    // write-side path as a prerender write: index deferred, answer from the
    // serialized echo.
    let answerFromEcho = duringPrerender || isSkipIndexWaitRequest(request);

    let { data: patch, included: maybeIncluded } = await request.json();
    if (!isCardResource(patch)) {
      return badRequest({
        message: `The request body was not a card document`,
        requestContext,
      });
    }
    if (maybeIncluded) {
      if (!Array.isArray(maybeIncluded)) {
        return badRequest({
          message: `Request body is not valid card JSON-API: included is not array`,
          requestContext,
        });
      }
      for (let sideLoadedResource of maybeIncluded) {
        if (!isCardResource(sideLoadedResource)) {
          return badRequest({
            message: `Request body is not valid card JSON-API: side-loaded data is not a valid card resource`,
            requestContext,
          });
        }
      }
    }

    // Built after the body is validated, so a payload the realm would have
    // refused anyway still gets the 400 naming what is wrong with it and a
    // 412 means only that the card moved. It runs inside the commit's lock.
    let precondition = this.#conditionalWrite(request, new URL(instanceURL));

    // The merge belongs to the update this stages: arrays replacing rather
    // than merging into what is there, the realm-managed `meta` keys a client
    // echo must never persist, a type that cannot change, the relationship
    // merge, and leaving an unchanged card's file exactly as it is. It runs
    // under the write lock on the card's own file, which spans the read of the
    // stored file and the write of the merged one, so two patches of one card
    // cannot both compute a merge over the same pre-state and have the second
    // silently lose the first. Two patches of *different* cards hold different
    // locks and do not wait on each other. The merge base is that stored file
    // rather than the index, which is downstream of it and can lag.
    //
    // Side-loaded resources ride along as the document's `included`, each
    // created under the `lid` the caller named it with, in the same batch as
    // the patch that links to them.
    let commit = async (reserialize?: true) =>
      (
        await commitBatch(
          this.batchCore,
          [
            {
              op: 'update',
              href: instanceURL,
              document: {
                data: patch,
                ...(maybeIncluded ? { included: maybeIncluded } : {}),
              },
              ...(reserialize ? { reserialize } : {}),
            },
          ],
          {
            clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
            ...(requestContext.authenticatedUser
              ? { actor: requestContext.authenticatedUser }
              : {}),
            // The same trade a create makes, for the same two reasons — see
            // `createCard`, where the deadlock this avoids is spelled out.
            ...(answerFromEcho ? { waitForIndex: false } : {}),
            // Read by both answers a patch can give that do not come from the
            // index: the deferred write's echo, and the browser-test fallback
            // below.
            reportStoredContent: true,
            // The same reading a create takes of a side-load claiming another
            // realm: the edge is stored empty and the patch succeeds.
            foreignSideLoadLink: 'leave',
            timings,
            ...(precondition ? { precondition } : {}),
          },
        )
      )[0];
    let result: BatchEntryResult;
    try {
      result = await commit();
    } catch (err: unknown) {
      return this.#cardWriteRefusal(err, request, requestContext, {
        id: instanceURL,
      });
    }
    let lastModified = result?.meta.lastModified;
    if (result == null || lastModified == null) {
      // The commit reports a modification time for every file it leaves
      // behind, whether it rewrote it or found it already holding these bytes,
      // so reaching here means the patch did not land as a write at all.
      return systemError({
        requestContext,
        message: `the patch of ${instanceURL} reported no modification time`,
        id: instanceURL,
      });
    }
    let created = result.meta.created;
    // The card and nothing around it: no `loadLinks`, so neither the
    // transitive closure of its links nor the query a query-backed field
    // would run to name its targets. Nothing consumes either off a write
    // response — the create path's readback states the case. The commit has
    // released the write lock by the time this runs, so what it costs is the
    // writer's own latency rather than every other writer's.
    let readEntry = async () =>
      await timings.time('readback', () =>
        this.#realmIndexQueryEngine.cardDocument(new URL(instanceURL)),
      );
    let doc: SingleCardDocument;
    if (!result.meta.changed) {
      // The patch left the card exactly as it was, so the answer is the card
      // as the realm already holds it — read before anything else is decided,
      // because a request that changed nothing is answered from the index
      // whether or not it asked for its own indexing to be deferred. It is
      // still answering a writer, so it takes the same narrow shape every
      // other write does.
      let unchanged = await readEntry();
      if (unchanged && unchanged.type !== 'error') {
        return await this.#patchedCardResponse(unchanged, {
          instanceURL,
          localPath,
          timings,
          // The file was not rewritten, so the modification time it carries is
          // the one the index recorded for it.
          lastModified: unchanged.doc.data.meta.lastModified ?? lastModified,
          created,
          requestContext,
        });
      }
      // The index holds no document for this card — it has never been indexed,
      // or its row records why it could not be. Nothing was written, so
      // nothing has been put in front of the indexer; rewriting the card in
      // canonical serialized form is what does that, and it is how an empty
      // patch stores and indexes a card the realm was holding but had not
      // read.
      try {
        result = await commit(true);
      } catch (err: unknown) {
        return this.#cardWriteRefusal(err, request, requestContext, {
          id: instanceURL,
        });
      }
      lastModified = result?.meta.lastModified ?? lastModified;
      created = result?.meta.created ?? created;
    }
    if (answerFromEcho) {
      // See serializedInstanceEcho: the write indexed deferred, so there is
      // nothing to read back yet. The document is the one the commit stored,
      // reported by the batch rather than read back off the file — which has
      // been open to every other writer since the commit released the lock.
      let stored = storedCardDocument(result);
      if (!stored) {
        return systemError({
          requestContext,
          message: `Unable to report patched card: ${instanceURL}, the commit reported no stored document`,
          id: instanceURL,
        });
      }
      // Timed as `stringify`, the stage the indexed answer reports for the
      // same work — building the response document and serializing it. The
      // echo reaches for the realm's info to build it, which on a cold cache
      // parses the realm's own file, so leaving it outside the stages would
      // put a read of unbounded cost after the last one this line reports.
      let echo = await timings.time('stringify', async () => {
        let built = await this.serializedInstanceEcho(
          stored,
          instanceURL,
          lastModified,
        );
        this.#serveInstanceIdsAsRRI(built);
        return { doc: built, body: JSON.stringify(built, null, 2) };
      });
      return createResponse({
        body: echo.body,
        init: {
          headers: {
            'content-type': SupportedMimeType.CardJson,
            'cache-control': this.cardJsonCacheControl(requestContext),
            ...lastModifiedHeader(echo.doc),
            ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
          },
        },
        requestContext,
      });
    }
    let entry = await readEntry();
    if (entry && entry.type !== 'error') {
      return await this.#patchedCardResponse(entry, {
        instanceURL,
        localPath,
        lastModified,
        created,
        requestContext,
        timings,
      });
    }
    let stored = storedCardDocument(result);
    if (
      !stored ||
      !isBrowserTestEnv() ||
      (globalThis as any).__emulateServerPatchFailure
    ) {
      return systemError({
        requestContext,
        message: `Unable to index card: can't find patched instance, ${instanceURL} in index`,
        id: instanceURL,
        additionalError: entry
          ? CardError.fromSerializableError(entry.error)
          : undefined,
      });
    }
    doc = merge({}, stored, {
      data: {
        id: instanceURL,
        links: { self: instanceURL },
        meta: {
          ...(stored.data.meta ?? {}),
          lastModified,
        },
      },
    }) as SingleCardDocument;
    // The index could not answer, so nothing primed the realm-info cache the
    // way a read does.
    await this.getRealmInfo();
    this.#serveInstanceIdsAsRRI(doc);
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: {
          'content-type': SupportedMimeType.CardJson,
          'cache-control': this.cardJsonCacheControl(requestContext),
          ...lastModifiedHeader(doc),
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
        },
      },
      requestContext,
    });
  }

  // The 200 a `PATCH` answers with when the index can speak for the card: the
  // card as it is indexed, validated by the same ETag a `GET` of it would
  // carry, and stamped with the stored file's own timestamps rather than the
  // index's reading of them.
  //
  // One builder for both answers a patch can give from the index — the card it
  // just wrote, and the card it left alone — because the two are the same
  // response and only differ in whether a write preceded them.
  async #patchedCardResponse(
    entry: SearchResultDoc,
    {
      instanceURL,
      localPath,
      lastModified,
      created,
      requestContext,
      timings,
    }: {
      instanceURL: string;
      localPath: LocalPath;
      lastModified: number | null;
      created: number | null;
      requestContext: RequestContext;
      timings: RequestTimings;
    },
  ): Promise<Response> {
    let doc: SingleCardDocument = merge({}, entry.doc, {
      data: {
        links: { self: instanceURL },
        meta: { lastModified },
      },
    });
    // The PATCH echo carries the joined `meta.screenshots` like a GET does —
    // the store replaces an instance's meta wholesale from a save response, so
    // an echo without it would wipe the key client-side until the next GET.
    // The two representations part company on the link graph only, which is
    // what the `write-echo` validator variant below records.
    if (entry.screenshots) {
      doc.data.meta = {
        ...doc.data.meta,
        screenshots: screenshotsMetaFromManifest(entry.screenshots, {
          realmURL: this.url,
          instanceLocalPath: localPath,
        }),
      };
    }
    // The read above primed the realm-info cache via attachRealmInfo(), so the
    // hash the ETag is built from is current as of this response.
    await this.getRealmInfo();
    let foreignDeps = this.hasForeignRealmDeps(entry.deps);
    let etag = foreignDeps
      ? undefined
      : buildCardJsonEtag(
          entry.indexedAt,
          this.getCachedRealmInfoHash(),
          screenshotsEtagFingerprint(entry.screenshots),
          'write-echo',
        );
    this.#serveInstanceIdsAsRRI(doc);
    // The last sequential leg: turning the assembled document into the bytes
    // that go on the wire. Stamped because it scales with the body, which is
    // what the shape of this response decides.
    let body = await timings.time('stringify', async () =>
      JSON.stringify(doc, null, 2),
    );
    return createResponse({
      body,
      init: {
        headers: {
          'content-type': SupportedMimeType.CardJson,
          'cache-control': this.cardJsonCacheControl(requestContext),
          ...(etag ? { etag } : {}),
          ...etagSuppressedHeader(foreignDeps),
          ...lastModifiedHeader(doc),
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
        },
      },
      requestContext,
    });
  }

  // A batch reports a refusal as an operations error, which is the envelope's
  // currency. The card verbs answer in statuses and bodies clients have always
  // read, so a refusal is carried back across into the response the handler
  // would have produced itself, keeping the status the batch chose.
  //
  // A 404 is spelled here rather than by the batch: the batch names the card
  // it resolved, where these routes name the URL the caller asked for.
  // Anything above 4xx that is not one of these two is a refusal the endpoint
  // has always thrown — a payload over the realm's ceiling, say — and it
  // travels the same way, so the status and sentence a client acts on do not
  // move.
  #cardWriteRefusal(
    err: unknown,
    request: Request,
    requestContext: RequestContext,
    identity: { id?: string; lid?: string } = {},
  ): Response {
    if (!isOperationFailure(err)) {
      throw err;
    }
    let { status, title, detail } = err.error;
    if (status === 404) {
      return notFound(request, requestContext);
    }
    if (status === 400) {
      return badRequest({ message: detail, requestContext, ...identity });
    }
    if (status >= 500) {
      return systemError({
        requestContext,
        message: detail,
        status,
        ...identity,
      });
    }
    // Identity travels on every other branch, so it travels on this one too:
    // a refusal that names no card is harder to act on than one that does, and
    // the 412 a conditional write answers with is precisely a refusal about a
    // particular card.
    throw new CardError(detail, {
      status,
      title,
      ...(identity.id ? { id: identity.id } : {}),
      ...(identity.lid ? { lid: identity.lid } : {}),
    });
  }

  // Card+JSON ETags are unsafe when the card has dependencies that live
  // in OTHER realms — `index-writer.calculateInvalidations` filters
  // dependents by `realm_url = $thisRealm` (see the comment there:
  // "probably need to reevaluate this condition when we get to cross
  // realm invalidation"), so a foreign card change propagates to the
  // foreign realm's `indexed_at` but never to ours. With cross-realm
  // invalidation off, a stable local `indexed_at` does NOT mean the
  // assembled `included[]` is current — `loadLinks` will re-fetch the
  // foreign card via HTTP and may surface new content. To avoid
  // serving stale 304s, suppress ETag emission entirely when any dep
  // points outside this realm.
  private hasForeignRealmDeps(deps: string[] | null | undefined): boolean {
    if (!deps?.length) {
      return false;
    }
    for (let dep of deps) {
      if (this.isForeignRealmDep(dep)) {
        return true;
      }
    }
    return false;
  }

  private isForeignRealmDep(dep: string): boolean {
    // Resolve registered prefixes back to absolute URLs first.
    // Production deployments register every realm via
    // `addRealmMapping`, so deps in `boxel_index.deps` are typically
    // stored in prefix form (`@cardstack/foreign-realm/foo.json`) —
    // comparing them as raw strings against `this.url` would always
    // say "not foreign" and the guard would silently fail to fire.
    let resolved: string;
    try {
      resolved = this.#virtualNetwork.toURL(dep).href;
    } catch {
      // Bare specifier with no matching prefix mapping. `loadLinks`
      // can't fetch it, so it's not a request-time mutation source —
      // not a foreign-instance dep for our purposes.
      return false;
    }
    // Only foreign card *instance* deps put us at risk of stale 304s.
    // Module deps (`.gts`/`.ts`/`.js`) and scoped CSS don't load
    // through `loadLinks` and don't contribute to the assembled
    // `included[]`. Cards universally adopt from base modules
    // (`https://cardstack.com/base/card-api.gts`) — treating those
    // as foreign would blanket-suppress every card's ETag. The
    // relationship-dependency extractor normalizes instance deps to
    // `.json` (see `dependency-normalization.ts`), so checking that
    // suffix isolates the deps we actually care about.
    if (!resolved.endsWith('.json')) {
      return false;
    }
    return !resolved.startsWith(this.url);
  }

  // How a card+json read shapes its links. A prerender must not recurse into
  // the search that resolves a query-backed field, and a read serving one is
  // already asking for less than a live read, so the link-shape policy does
  // not reach it.
  //
  // One decision for every verb that reads a card, rather than one apiece.
  // Both values are folded into the validator, so two verbs deciding
  // differently would hand out different validators for the same card. Nothing
  // here varies by verb, so within one request there is nothing to keep in
  // step; across the `HEAD` / `GET` pair it is the policy's dwell floor that
  // holds them together, not this method (see `#decideLinkShape`).
  //
  // A card read returns one card, so it is the row class a closure is cheapest
  // for and the last one the policy degrades.
  #cardJsonLinkShape(request: Request): {
    skipQueryBackedExpansion: boolean;
    resolveLinksOnly: boolean;
    skipLinkAssemblyBudget: boolean;
  } {
    let duringPrerender = isDuringPrerenderRequest(request);
    return {
      skipQueryBackedExpansion: duringPrerender,
      resolveLinksOnly:
        this.#decideLinkShape(request, 'single-row')?.mode === 'links-only',
      // The assembled-resource budget bounds live reads. This branch exempts a
      // read carrying the during-prerender marker, for the same reason the
      // prerendered-HTML leg is exempt from the page and time bounds: what a
      // render assembles is baked into cached HTML, so a ceiling that clipped
      // it would serve a short closure from cache long after the pressure that
      // justified it had passed.
      //
      // It is defensive rather than load-bearing. No caller attaches that
      // marker to a card+json request, so the exemption a render relies on is
      // the one on the card+html entry leg, which does receive it and does run
      // the assembly pass. The branch stays so it is correct if the marker ever
      // arrives here. The validator names the exemption rather than the
      // ceiling, so an exempt body and a bounded one never share one — see
      // `buildCardJsonEtag`.
      skipLinkAssemblyBudget: duringPrerender,
    };
  }

  private cardJsonCacheControl(requestContext: RequestContext): string {
    // Mirrors the source/module convention for the public/private
    // visibility decision (world-readable realms get `public` so a
    // CDN can revalidate; auth-gated realms get `private` so a shared
    // cache won't serve one user's body to another). Adds an explicit
    // `must-revalidate` that source/module don't need: card+json
    // responses are richer (full JSON:API doc), so we want to be
    // strict that intermediaries can't serve stale-while-revalidate
    // even briefly. With `max-age=0` the browser always asks, the
    // ETag short-circuit returns 304 cheaply when nothing changed.
    let cacheVisibility = requestContext.permissions['*']?.includes('read')
      ? 'public'
      : 'private';
    return `${cacheVisibility}, max-age=0, must-revalidate`;
  }

  // Serve instance ids in canonical RRI (prefix) form. Unresolves the primary
  // resource's `id` / `links.self` / relationship ids and every loaded link
  // from URL to registered-prefix form. Unmapped realms have no prefix
  // mapping, so this is a no-op there (ids stay URL). The write handlers derive
  // the on-disk path from the request path / `lid` (not `data.id`), so accepting
  // a prefix-form id needs no change — only the responses are canonicalized.
  #serveInstanceIdsAsRRI(doc: {
    data: LooseCardResource | FileMetaResource;
    included?: (LooseCardResource | FileMetaResource)[];
  }): void {
    unresolveResourceInstanceURLs(doc.data, this.#virtualNetwork);
    for (let resource of doc.included ?? []) {
      unresolveResourceInstanceURLs(resource, this.#virtualNetwork);
    }
  }

  // Read-your-writes gate for the card read endpoints (card+json /
  // card+html GET). The +source POST indexes deferred (it returns once the
  // bytes are durable), so a GET that immediately follows the same client's
  // definition rewrite would otherwise read a stale snapshot — e.g. a
  // post-rename instance still serialized under the old schema. Waiting is a freshness courtesy, not a correctness
  // requirement: incremental jobs write into the working table and the
  // production rows stay live (and mutually consistent) until the completed
  // batch swaps in, so a read during indexing serves the previous
  // generation, never a torn one. That shapes both bounds here:
  //
  //   - Scoped to the requester. Only the principal whose own write is in
  //     flight has a read-your-writes expectation; every other reader takes
  //     the current generation immediately. A write-heavy user (or a module
  //     edit whose invalidation set spans the realm's module graph) must not
  //     park every reader of the realm behind their job. A provably
  //     credential-less caller has no read-your-writes claim at all —
  //     anonymous writes are unsupported — so an anonymous read skips the
  //     gate outright and never parks behind an identified user's reindex.
  //     System-originated jobs (file watcher, realm copy)
  //     are untagged and hold no scoped reader — no one has a
  //     read-your-writes claim on them. Only when the requester is genuinely
  //     unknown — a token that failed verification, an assume-user
  //     indirection the public path cannot validate, or a realm-internal
  //     dispatch — does the drain conservatively cover all pending
  //     incremental jobs, since the writer might be behind any of them.
  //   - Bounded. The job being awaited can also sit queued behind other
  //     realms' work in a saturated worker pool; past the budget the read
  //     proceeds on the current generation and the index event that follows
  //     the swap refreshes the client.
  //
  // A prerender-originated request skips the gate entirely: its tab holds a
  // render slot that the pending job may itself be waiting on, so any wait
  // here is at best dead time and at worst a deadlock held for the budget.
  //
  // Every read that arrives while incremental indexing is pending emits one
  // `realm:read-index-gate` key=value line (`outcome=` skipped-prerender /
  // skipped-not-writer / settled / budget-expired, with `waitMs=` and the
  // requester principal on the waited outcomes) — the skipped outcomes count
  // reads an unscoped gate would have parked, the waited ones measure what
  // the requester-scoped hold actually costs. Steady-state reads (nothing
  // pending) emit nothing. budget-expired logs at warn; the rest at info.
  private async drainRequestersOwnIndexing(
    request: Request,
    requestContext: RequestContext,
  ): Promise<void> {
    let anyPending = this.incrementalIndexing();
    if (!anyPending) {
      return;
    }
    let emit = (
      level: 'info' | 'warn',
      outcome: string,
      fragment: string = '',
    ) =>
      this.#readGateLog[level](
        `outcome=${outcome}${fragment} url=${maskLoggedURL(request.url)}`,
      );
    if (isDuringPrerenderRequest(request)) {
      emit('info', 'skipped-prerender');
      return;
    }
    if (requestContext.anonymous) {
      // A provably credential-less caller has no write in flight to wait on
      // (anonymous writes are unsupported), so they are never the writer.
      emit('info', 'skipped-not-writer');
      return;
    }
    let requester = requestContext.authenticatedUser;
    let pending: Promise<void> | undefined;
    let scope: 'own' | 'all';
    if (requester !== undefined) {
      pending =
        this.#realmIndexUpdater.incrementalIndexingInitiatedBy(requester);
      if (!pending) {
        emit('info', 'skipped-not-writer');
        return;
      }
      scope = 'own';
    } else {
      pending = anyPending;
      scope = 'all';
    }
    let waitStartedAt = Date.now();
    let settled = await settledBy(
      pending,
      waitStartedAt + this.#readIndexDrainBudgetMs,
    );
    let fragment =
      ` scope=${scope} waitMs=${Date.now() - waitStartedAt}` +
      (requester !== undefined ? ` user=${requester}` : '');
    if (settled) {
      emit('info', 'settled', fragment);
    } else {
      // Past the budget the read proceeds on the current index generation.
      emit('warn', 'budget-expired', fragment);
    }
  }

  // The card+json `HEAD`: the headers a `GET` of the same URL would send, and
  // no body work to produce them. The read runs in its headers-only mode, so
  // no card document is assembled and no link is expanded — which is the whole
  // point of asking, since a caller that wanted the body would have sent a
  // `GET`. `Content-Length` is left off for the same reason: knowing it means
  // serializing the document.
  //
  // Realm discovery also arrives as a `HEAD`, on any path and without
  // credentials, and reads only the realm-identity headers every response
  // carries. So the read here is offered to a caller that may have it and the
  // discovery answer to everyone else: permission is asked rather than
  // enforced, and a caller who cannot read gets the realm-identity answer
  // instead of a 401 that would tell them the realm exists and refuse them.
  // Every other `Accept` bucket keeps that answer outright — this route is
  // registered for card+json alone.
  private async headCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    if (!(await this.permittedToRead(request, requestContext))) {
      return this.realmIdentityResponse(requestContext);
    }
    // Read-your-writes, as on the `GET`: a validator computed off an index the
    // requester's own write has not reached yet would 304 their next `GET`
    // against state they just superseded.
    await this.drainRequestersOwnIndexing(request, requestContext);
    let requestedLocalPath = this.paths.local(new URL(request.url));
    if (requestedLocalPath.endsWith('.json')) {
      // The canonical extension-less URL is the only one that ever carries a
      // validator, so the `.json` spelling is redirected here as it is on the
      // `GET` rather than answered with headers a client would file under the
      // wrong cache key.
      let canonicalPath = this.paths.local(
        this.paths.fileURL(
          requestedLocalPath.replace(/\.json$/, '') || 'index',
        ),
      );
      return createResponse({
        requestContext,
        body: null,
        init: {
          status: 302,
          headers: { Location: this.redirectTarget(canonicalPath) },
        },
      });
    }
    let localPath = requestedLocalPath === '' ? 'index' : requestedLocalPath;
    let url = this.paths.fileURL(localPath);
    let start = Date.now();
    try {
      let {
        skipQueryBackedExpansion,
        resolveLinksOnly,
        skipLinkAssemblyBudget,
      } = this.#cardJsonLinkShape(request);
      let result: OperationResult;
      try {
        result = await runOperation(
          this.operationCore,
          {
            target: { kind: 'instance', url: url.href },
            name: 'read',
            ...this.#callerOf(request, requestContext),
          },
          // No budget flag: a headers-only read assembles no closure, so there
          // is nothing for it to bound.
          { headersOnly: true, skipQueryBackedExpansion, resolveLinksOnly },
        );
      } catch (e) {
        if (!isOperationFailure(e)) {
          throw e;
        }
        return await this.#respondToCardJsonOutcome(
          cardJsonAssemblyFromFailure(e),
          request,
          requestContext,
          url,
        );
      }
      if (!isHeadResult(result)) {
        throw new Error(
          `the headers-only read of ${url.href} answered with something other than headers`,
        );
      }
      if (result.type === 'file-meta') {
        // A `GET` of a path that holds bytes answers with the file's metadata
        // document, which is derived from those bytes and has no index row
        // behind it — so there is no validator and no cache directive to
        // report, and a `HEAD` that invented one would describe a response the
        // `GET` never sends.
        return createResponse({
          requestContext,
          body: null,
          init: { headers: { 'content-type': SupportedMimeType.CardJson } },
        });
      }
      await this.getRealmInfo();
      let foreignDeps = this.hasForeignRealmDeps(result.deps);
      let etag = foreignDeps
        ? undefined
        : buildCardJsonEtag(
            result.indexedAt,
            this.getCachedRealmInfoHash(),
            screenshotsEtagFingerprint(result.screenshots),
            resolveLinksOnly ? 'links-only' : 'full',
            skipLinkAssemblyBudget,
          );
      let cacheControl = this.cardJsonCacheControl(requestContext);
      let lastModified: Record<string, string> =
        result.lastModified != null
          ? { 'last-modified': formatRFC7231(result.lastModified * 1000) }
          : {};
      let ifNoneMatch = request.headers.get('if-none-match');
      if (ifNoneMatch && etag && ifNoneMatchMatches(ifNoneMatch, etag)) {
        // A conditional request is answered the same way whichever verb asked
        // it: the validator matched, so there is nothing to send.
        return createResponse({
          requestContext,
          varyOn: LINK_SHAPE_VARY,
          body: null,
          init: {
            status: 304,
            headers: { etag, 'cache-control': cacheControl, ...lastModified },
          },
        });
      }
      let created = await this.getCreatedTime(
        (this.paths.local(url) + '.json') as LocalPath,
      );
      return createResponse({
        requestContext,
        varyOn: LINK_SHAPE_VARY,
        body: null,
        init: {
          headers: {
            'content-type': SupportedMimeType.CardJson,
            'cache-control': cacheControl,
            ...(etag ? { etag } : {}),
            ...etagSuppressedHeader(foreignDeps),
            ...lastModified,
            ...(created != null
              ? { 'x-created': formatRFC7231(created * 1000) }
              : {}),
          },
        },
      });
    } finally {
      this.#logRequestPerformance(request, start);
    }
  }

  // The realm-identity answer: the headers `createResponse` stamps on every
  // response and nothing else. It is what a discovery probe reads, and what a
  // `HEAD` falls back to whenever it is not answering a read.
  private realmIdentityResponse(requestContext: RequestContext): Response {
    return createResponse({ init: { status: 200 }, requestContext });
  }

  // Whether this caller may read the realm — asked, not enforced. The
  // realm-wide `HEAD` exemption is deliberately not taken: it exists so a
  // discovery probe can be answered without credentials, and a caller riding
  // it has shown nothing about what it may read. A `HEAD` that answers a card's
  // real headers is a read, so it asks the question a `GET` would.
  private async permittedToRead(
    request: Request,
    requestContext: RequestContext,
  ): Promise<boolean> {
    try {
      await this.checkPermission(request, requestContext, 'read', {
        probe: true,
      });
      return true;
    } catch (e) {
      if (e instanceof AuthenticationError || e instanceof AuthorizationError) {
        return false;
      }
      throw e;
    }
  }
  private async getCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Read-your-writes: wait (scoped, bounded) on the requester's own
    // in-flight incremental indexing before reading the card from the
    // index. See drainRequestersOwnIndexing.
    await this.drainRequestersOwnIndexing(request, requestContext);
    let requestedLocalPath = this.paths.local(new URL(request.url));
    let requestedHadJsonExtension = requestedLocalPath.endsWith('.json');
    // `.json` requests always 302 to the canonical no-extension URL,
    // regardless of cache state. Doing the redirect before any DB
    // peek keeps clients consistent: the canonical URL is the only
    // one that ever serves a 200 + ETag, and intermediaries that
    // cache the 302 don't end up holding a cache key against the
    // `.json` form. (Was previously only checked on the cache-miss
    // path, so a `.json` request with `If-None-Match` could short-
    // circuit to 304 with no redirect — splitting client/server
    // cache keys.)
    if (requestedHadJsonExtension) {
      let canonicalPath = this.paths.local(
        this.paths.fileURL(
          requestedLocalPath.replace(/\.json$/, '') || 'index',
        ),
      );
      return createResponse({
        requestContext,
        body: null,
        init: {
          status: 302,
          headers: {
            Location: this.redirectTarget(canonicalPath),
          },
        },
      });
    }
    let localPath = requestedLocalPath;
    if (localPath === '') {
      localPath = 'index';
    }
    let url = this.paths.fileURL(localPath);
    let start = Date.now();
    try {
      let cacheControl = this.cardJsonCacheControl(requestContext);
      let ifNoneMatch = request.headers.get('if-none-match');
      let documentCache = this.#cardDocumentCache;
      // Decided here rather than at the assembly because the validator below
      // has to describe the shape the assembly will produce, and that
      // validator is what the conditional request and the response cache are
      // both keyed on.
      let {
        skipQueryBackedExpansion,
        resolveLinksOnly,
        skipLinkAssemblyBudget,
      } = this.#cardJsonLinkShape(request);

      // The `instance()` peek, which yields this card's validator. It runs
      // for a client that sent a validator of its own to compare against,
      // and for a configured response cache, which keys on that same
      // validator — one row read answers both, so neither pays for the
      // other. With neither in play we skip it, since `cardDocument()` below
      // does its own `instance()` lookup and this read would be pure
      // duplication.
      //
      // With a cache configured, a request that goes on to miss pays that
      // read twice. That is the trade the cache is: one index-row lookup
      // against an assembly that expands the card's whole link closure, at a
      // duplication ratio where the same card is read many times per index
      // generation. Note that today's conditional-GET traffic already pays
      // it — card+json is served `max-age=0, must-revalidate` with an ETag,
      // so a client that has seen the card once sends `If-None-Match`.
      let peekEtag: string | undefined;
      if (ifNoneMatch || documentCache) {
        await this.getRealmInfo();
        let realmInfoHash = this.getCachedRealmInfoHash();
        let instanceEntry = await this.#realmIndexQueryEngine.instance(url, {
          includeErrors: true,
        });
        if (instanceEntry === undefined) {
          if (await this.nonJsonFileExists(localPath)) {
            // A path that points to a non-JSON file (e.g. an uploaded
            // binary) was asked for as card+json. Return a file-meta JSON
            // document so the caller receives valid JSON it can
            // discriminate via `data.type === 'file-meta'` — instead of
            // raw binary bytes that crash a downstream `response.json()`.
            let fileMeta = await this.fileMetaDocument(
              requestContext,
              localPath,
              SupportedMimeType.CardJson,
            );
            return fileMeta ?? notFound(request, requestContext);
          } else {
            return await this.missingInstanceResponse(
              request,
              requestContext,
              localPath,
            );
          }
        }
        if (
          !this.hasForeignRealmDeps(instanceEntry.deps) &&
          instanceEntry.type === 'instance' &&
          instanceEntry.indexedAt != null
        ) {
          peekEtag = buildCardJsonEtag(
            instanceEntry.indexedAt,
            realmInfoHash,
            screenshotsEtagFingerprint(instanceEntry.screenshots),
            resolveLinksOnly ? 'links-only' : 'full',
            skipLinkAssemblyBudget,
          );
        }
        if (
          ifNoneMatch &&
          peekEtag &&
          ifNoneMatchMatches(ifNoneMatch, peekEtag)
        ) {
          return createResponse({
            requestContext,
            varyOn: LINK_SHAPE_VARY,
            body: null,
            init: {
              status: 304,
              headers: {
                etag: peekEtag,
                'cache-control': cacheControl,
                ...(instanceEntry.lastModified != null
                  ? {
                      'last-modified': formatRFC7231(
                        instanceEntry.lastModified * 1000,
                      ),
                    }
                  : {}),
              },
            },
          });
        }
      }

      // Cache miss (or the conditional was a non-match): assemble the full
      // doc. A card whose peek produced no validator — no index row yet, or
      // foreign-realm dependencies that make one unsafe — assembles outside
      // the response cache, since it has no key that would make a superseded
      // entry unreachable.
      let assemble = () =>
        this.#assembleCardJson(
          url,
          localPath,
          skipQueryBackedExpansion,
          resolveLinksOnly,
          skipLinkAssemblyBudget,
          peekEtag,
          this.#callerOf(request, requestContext),
        );
      let assembly: CardJsonAssembly;
      let cacheOutcome: CardDocumentCacheOutcome | undefined;
      if (documentCache && peekEtag) {
        ({ assembly, outcome: cacheOutcome } =
          await documentCache.getOrPopulate({
            url: url.href,
            etag: peekEtag,
            skipQueryBackedExpansion,
            populate: assemble,
          }));
      } else {
        assembly = await assemble();
      }
      // Every outcome reports how the cache served it, not just the ones
      // that produced a body: a joined 404 still says the request shared
      // someone else's computation, which is what the hit rate is measuring.
      let cacheOutcomeHeader: Record<string, string> = cacheOutcome
        ? { [CARD_DOCUMENT_CACHE_HEADER]: cacheOutcome }
        : {};
      if (assembly.kind !== 'document') {
        let response = await this.#respondToCardJsonOutcome(
          assembly,
          request,
          requestContext,
          url,
        );
        for (let [name, value] of Object.entries(cacheOutcomeHeader)) {
          response.headers.set(name, value);
        }
        return response;
      }
      return createResponse({
        body: assembly.body,
        varyOn: LINK_SHAPE_VARY,
        init: {
          headers: {
            'content-type': SupportedMimeType.CardJson,
            'cache-control': cacheControl,
            ...(assembly.etag ? { etag: assembly.etag } : {}),
            ...etagSuppressedHeader(assembly.etagSuppressed),
            ...(assembly.lastModified != null
              ? {
                  'last-modified': formatRFC7231(assembly.lastModified * 1000),
                }
              : {}),
            ...(assembly.created != null
              ? { 'x-created': formatRFC7231(assembly.created * 1000) }
              : {}),
            ...cacheOutcomeHeader,
          },
        },
        requestContext,
      });
    } finally {
      this.#logRequestPerformance(request, start);
    }
  }

  // One assembly of a card+json GET body, and the unit the response cache
  // coalesces on. The servable-body case comes back as the cacheable
  // `document` shape — the serialized bytes plus the header values that are
  // functions of the same index row. Every other outcome comes back as data
  // describing what happened, never as a `Response` or a closure over this
  // request: two requests can share one assembly, so each renders the
  // outcome against its own request and request context.
  async #assembleCardJson(
    url: URL,
    localPath: LocalPath,
    skipQueryBackedExpansion: boolean,
    resolveLinksOnly: boolean,
    skipLinkAssemblyBudget: boolean,
    keyEtag: string | undefined,
    caller: { actor: string; clientRequestId: string },
  ): Promise<CardJsonAssembly> {
    // The document itself is the `read` operation's — link expansion, the
    // `links.self` and prefix-form ids, the freshly joined `meta.generation`
    // and `meta.screenshots`, the file-metadata answer for a path that holds
    // bytes, and which absence a missing row is. What stays here is the
    // response around it: the validator, the redirect, the creation time, and
    // the mapping from a refusal to a status.
    //
    // The caller travels with the request although a plain read never consults
    // it, so that the first read that does cannot silently read a stale one.
    // That an assembly is shareable between callers rests on the same thing
    // the response cache's sharing does: a plain read is the same document for
    // everyone permitted to ask for it. A `read` an author has specialized is
    // refused rather than served, so nothing actor-dependent reaches here.
    let result: OperationResult;
    try {
      // The read runs `attachRealmInfo()`, which (re)populates the realm-info
      // cache, so the hash the ETag below folds in reflects the post-assembly
      // realm info.
      result = await runOperation(
        this.operationCore,
        {
          target: { kind: 'instance', url: url.href },
          name: 'read',
          actor: caller.actor,
          clientRequestId: caller.clientRequestId,
        },
        { skipQueryBackedExpansion, resolveLinksOnly, skipLinkAssemblyBudget },
      );
    } catch (e) {
      if (!isOperationFailure(e)) {
        throw e;
      }
      return cardJsonAssemblyFromFailure(e);
    }
    if (!isDocumentResult(result)) {
      throw new Error(
        `the read of ${url.href} answered with something other than a document`,
      );
    }
    let { document, headers, queryBacked } = result;
    if (document.data.type === 'file-meta') {
      // A file's metadata is derived from its bytes, so there is no index row
      // to validate it against and nothing here to cache.
      return { kind: 'file-meta', body: JSON.stringify(document, null, 2) };
    }
    let card = document;

    // The 302 redirect for the `.json` form is done up-front (see top of
    // getCard). Here we only need to redirect for the normalization case where
    // `paths.fileURL(localPath)` produces a different `paths.local()` than
    // what we started with.
    let foundPath = this.paths.local(url);
    if (localPath !== foundPath) {
      return { kind: 'redirect', foundPath };
    }

    // Prefer created_at from DB for instance JSON
    let pathForDb = this.paths.local(url) + '.json';
    let createdAt = await this.getCreatedTime(pathForDb);
    // deps + indexedAt come off the assembly the read reports, not off the
    // early peek: the two see different snapshots when a write lands between
    // them, and a validator has to describe the bytes it is sent with.
    // Suppress the ETag if the doc depends on foreign-realm cards: cross-realm
    // invalidation doesn't cascade `indexed_at`, so a validator we emit here
    // could 304 a follow-up request whose `included[]` should have been
    // re-fetched from the foreign realm. A suppressed validator also makes
    // this assembly unretainable — the response cache keys on the validator,
    // so without one there is nothing that would make a superseded entry
    // unreachable.
    let foreignDeps = this.hasForeignRealmDeps(headers.deps);
    let responseEtag = foreignDeps
      ? undefined
      : buildCardJsonEtag(
          headers.indexedAt,
          this.getCachedRealmInfoHash(),
          screenshotsEtagFingerprint(headers.screenshots),
          resolveLinksOnly ? 'links-only' : 'full',
          skipLinkAssemblyBudget,
        );
    return {
      kind: 'document',
      body: JSON.stringify(card, null, 2),
      etag: responseEtag,
      etagSuppressed: foreignDeps,
      queryBacked,
      keyEtag: keyEtag ?? '',
      lastModified: card.data.meta.lastModified,
      created: createdAt,
    };
  }

  // Render a non-document assembly outcome against THIS request. Kept apart
  // from the assembly itself so a request that joined someone else's
  // computation builds its own response from its own context.
  async #respondToCardJsonOutcome(
    assembly: Exclude<CardJsonAssembly, { kind: 'document' }>,
    request: Request,
    requestContext: RequestContext,
    url: URL,
  ): Promise<Response> {
    if (assembly.kind === 'file-meta') {
      // A path that holds bytes rather than a card (an uploaded binary, say)
      // was asked for as card+json, so the answer is the file's metadata
      // document — valid JSON the caller discriminates via
      // `data.type === 'file-meta'`, instead of raw bytes that crash a
      // downstream `response.json()`.
      return createResponse({
        body: assembly.body,
        init: { headers: { 'content-type': SupportedMimeType.CardJson } },
        requestContext,
      });
    }
    if (assembly.kind === 'not-found') {
      return notFound(request, requestContext);
    }
    if (assembly.kind === 'not-indexed') {
      // The card's source is on disk and the index has not caught up. A read
      // served by the replica that took the write rarely gets here — that path
      // drains its own in-flight indexing first — but a read served by any
      // other replica has no such handle on the write.
      return notIndexedYet(request, requestContext);
    }
    if (assembly.kind === 'redirect') {
      return createResponse({
        requestContext,
        body: null,
        init: {
          status: 302,
          headers: { Location: this.redirectTarget(assembly.foundPath) },
        },
      });
    }
    // The index has a row for this card, it just can't be served
    // cleanly — so mirror the underlying error's HTTP status when it
    // is a real HTTP error status (auth 401/403, validation 422,
    // upstream 5xx, …) instead of flattening everything to 500.
    //
    // 404 is the one status we never mirror: an existing-but-errored
    // card is not "not found". 404 is reserved for a missing index
    // row (see `notFound` above) so that a 404 on a card GET is an
    // unambiguous "this card no longer exists" signal. A recorded
    // 404 (e.g. an error whose underlying cause was a missing linked
    // instance) therefore falls back to 500, as do non-HTTP failures
    // (fetch failures recorded as status 0) and any out-of-range
    // value.
    let { error } = assembly;
    return systemError({
      requestContext,
      status:
        error.status >= 400 && error.status <= 599 && error.status !== 404
          ? error.status
          : 500,
      message: `cannot return card, ${maskLoggedURL(request.url)}, from index: ${error.title} - ${error.message}`,
      id: request.url,
      additionalError: CardError.fromSerializableError({
        status: error.status,
        title: error.title,
        message: error.message,
        ...(error.stack !== undefined ? { stack: error.stack } : {}),
        additionalErrors: null,
      }),
      // This is based on https://jsonapi.org/format/#errors
      body: {
        id: url.href,
        status: error.status,
        title: error.title,
        message: error.message,
        // note that this is actually available as part of the response
        // header too--it's just easier for clients when it is here
        meta: {
          lastKnownGoodHtml: error.lastKnownGoodHtml,
          cardTitle: error.cardTitle,
          scopedCssUrls: error.scopedCssUrls,
          stack: error.stack,
        },
      },
    });
  }

  // The single-instance card+html GET: one `entry` sourced by URL, carrying
  // the card's selected rendering (`html`) plus its `item` serialization — the
  // single-instance counterpart to `_search` and the primitive the host's
  // selective refresh uses to update one member's HTML without re-running a
  // whole query.
  private async getCardHtml(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    return this.#entryHtmlResponse(request, requestContext, 'instance');
  }

  // The file counterpart of `getCardHtml`: one file's `entry` (a native
  // rendering + its `file-meta` serialization).
  private async getFileMetaHtml(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    return this.#entryHtmlResponse(request, requestContext, 'file');
  }

  async #entryHtmlResponse(
    request: Request,
    requestContext: RequestContext,
    kind: 'instance' | 'file',
  ): Promise<Response> {
    let mimeType =
      kind === 'file'
        ? SupportedMimeType.FileMetaHtml
        : SupportedMimeType.CardHtml;

    // Read-your-writes: wait (scoped, bounded) on the requester's own
    // in-flight incremental indexing first, exactly as `getCard` does. See
    // drainRequestersOwnIndexing.
    await this.drainRequestersOwnIndexing(request, requestContext);

    let htmlQuery: HtmlQuery;
    let fieldset: SearchEntryFieldset;
    try {
      let { searchParams } = new URL(request.url);
      // `?format=` (default fitted) + optional `?renderType=<module>/<name>`
      // select the rendering; `?fields=` (html | item | html,item) is the
      // sparse fieldset. Both mirror the html. branch, sourced from the query
      // string rather than a request body.
      htmlQuery = htmlQueryFromParams({
        format: searchParams.get('format'),
        renderType: searchParams.get('renderType'),
      });
      fieldset = fieldsetFromParam(searchParams.get('fields'));
    } catch (e) {
      if (e instanceof SearchRequestError) {
        return createResponse({
          body: JSON.stringify(buildSearchErrorBody(e.message)),
          init: {
            status: 400,
            headers: { 'content-type': mimeType },
          },
          requestContext,
        });
      }
      throw e;
    }

    let localPath = this.paths.local(new URL(request.url));
    if (localPath === '') {
      localPath = 'index';
    }
    // Instance rows key on their `.json` file URL; file rows on the bare path.
    let dbUrl =
      kind === 'file'
        ? this.paths.fileURL(localPath)
        : this.paths.fileURL(
            `${localPath.replace(/\.json$/, '') || 'index'}.json`,
          );

    // The third live read that assembles a closure. A fieldset that names no
    // rendering falls back to an item, and the host's selective refresh asks
    // for `item` directly, so this route serializes cards with their links as
    // often as the other two — and a refresh here would put back exactly the
    // closure a search left out.
    // One entry's worth of card, so it classifies with the card read rather
    // than with a search — the same row class, and therefore the same answer
    // from the policy at every level.
    let duringPrerender = isDuringPrerenderRequest(request);
    let resolveLinksOnly =
      this.#decideLinkShape(request, 'single-row')?.mode === 'links-only';
    let doc = await this.#realmIndexQueryEngine.searchEntry(
      dbUrl,
      { htmlQuery, fieldset, kind },
      {
        loadLinks: true,
        ...(duringPrerender
          ? { cacheOnlyDefinitions: true, skipLinkAssemblyBudget: true }
          : {}),
        ...(resolveLinksOnly ? { resolveLinksOnly: true } : {}),
      },
    );
    if (!doc) {
      return notFound(request, requestContext);
    }

    // `searchEntry` ran `attachRealmInfo`, which (re)populated the realm-info
    // cache, so the hash we fold into an item-bearing response's ETag reflects
    // the realm info the item was just serialized with.
    let etag = buildEntryHtmlEtag(
      doc,
      this.getCachedRealmInfoHash(),
      resolveLinksOnly,
      duringPrerender,
    );
    let ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, etag)) {
      return createResponse({
        requestContext,
        varyOn: LINK_SHAPE_VARY,
        body: null,
        init: {
          status: 304,
          headers: { etag, 'content-type': mimeType },
        },
      });
    }
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': mimeType, etag },
      },
      varyOn: LINK_SHAPE_VARY,
      requestContext,
    });
  }

  private async getCardMarkdown(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let requestedLocalPath = this.paths.local(new URL(request.url));
    let localPath = requestedLocalPath;
    if (localPath === '') {
      localPath = 'index';
    }
    let trimmedLocalPath = localPath.replace(/\.json$/, '');
    let url = this.paths.fileURL(trimmedLocalPath);
    let instanceEntry = await this.#realmIndexQueryEngine.instance(url, {
      includeErrors: true,
    });
    if (instanceEntry) {
      if (instanceEntry.type === 'instance-error') {
        return notAcceptable(
          request,
          requestContext,
          `markdown representation unavailable: ${maskLoggedURL(request.url)} has an indexing error`,
        );
      }
      if (instanceEntry.markdown == null) {
        return notAcceptable(
          request,
          requestContext,
          `markdown representation not available for ${maskLoggedURL(request.url)}`,
        );
      }
      return createResponse({
        body: instanceEntry.markdown,
        init: {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
          },
        },
        requestContext,
      });
    }
    // No instance row — for FileDef rows (e.g. `.md`, `.csv`, `.gts`) the
    // markdown lives on the `file` entry instead. Look the unstripped local
    // path up against the file index before giving up. Without this branch
    // CardsGrid's "Copy as Markdown" action 415s on any non-card file.
    let fileURL = this.paths.fileURL(localPath);
    let fileEntry = await this.#realmIndexQueryEngine.file(fileURL);
    if (fileEntry) {
      if (fileEntry.markdown == null) {
        return notAcceptable(
          request,
          requestContext,
          `markdown representation not available for ${maskLoggedURL(request.url)}`,
        );
      }
      return createResponse({
        body: fileEntry.markdown,
        init: {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
          },
        },
        requestContext,
      });
    }
    if (await this.nonJsonFileExists(localPath)) {
      return unsupportedMediaType(request, requestContext);
    }
    return notFound(request, requestContext);
  }

  private async removeCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (await this.nonJsonFileExists(localPath)) {
      return unsupportedMediaType(request, requestContext);
    }
    let reqURL = request.url.replace(/\.json$/, '');
    // strip off query params
    let url = new URL(new URL(reqURL).pathname, reqURL);
    localPath = this.paths.local(url);
    if (await this.openFileForMetadata(localPath)) {
      return methodNotAllowed(request, requestContext);
    }
    let precondition = this.#conditionalWrite(request, url);
    try {
      // Whether there is a card here is settled by the stored file, read
      // inside the same lock the removal happens under. That is what makes a
      // card removable the moment it is written rather than once indexing has
      // caught up with it, and it is also what tells a card's `.json` from a
      // JSON file the realm merely holds — which has no card to remove.
      await commitBatch(this.batchCore, [{ op: 'delete', href: url.href }], {
        ...(requestContext.authenticatedUser
          ? { actor: requestContext.authenticatedUser }
          : {}),
        ...(precondition ? { precondition } : {}),
      });
    } catch (err: unknown) {
      return this.#cardWriteRefusal(err, request, requestContext, {
        id: url.href,
      });
    }
    return createResponse({
      body: null,
      init: { status: 204 },
      requestContext,
    });
  }

  // Look up created_at for a given file path from realm_file_meta
  private async getCreatedTime(path: LocalPath): Promise<number | undefined> {
    if (!this.#dbAdapter) return undefined;
    return getCreatedTime(this.#dbAdapter, this.url, path);
  }

  private async directoryEntries(
    url: URL,
  ): Promise<{ name: string; kind: Kind; path: LocalPath }[] | undefined> {
    if (await this.isIgnored(url)) {
      return undefined;
    }
    let path = this.paths.local(url);
    if (!(await this.#adapter.exists(path))) {
      return undefined;
    }
    let entries: { name: string; kind: Kind; path: LocalPath }[] = [];

    for await (let entry of this.#adapter.readdir(path)) {
      let innerPath = join(path, entry.name);
      let innerURL =
        entry.kind === 'directory'
          ? this.paths.directoryURL(innerPath)
          : this.paths.fileURL(innerPath);
      if (await this.isIgnored(innerURL)) {
        continue;
      }
      entries.push(entry);
    }
    return entries;
  }

  private async getDirectoryListing(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // a LocalPath has no leading nor trailing slash
    let localPath: LocalPath = this.paths.local(new URL(request.url));
    let url = this.paths.directoryURL(localPath);
    let entries = await this.directoryEntries(url);
    if (!entries) {
      this.#log.warn(`can't find directory ${url.href}`);
      return notFound(request, requestContext);
    }

    let data: ResourceObjectWithId = {
      id: url.href,
      type: 'directory',
      relationships: {},
    };

    let dir = this.paths.local(url);
    // the entries are sorted such that the parent directory always
    // appears before the children
    entries.sort((a, b) =>
      `/${join(dir, a.name)}`.localeCompare(`/${join(dir, b.name)}`),
    );
    for (let entry of entries) {
      let meta: FileMeta | DirectoryMeta;
      if (entry.kind === 'file') {
        let innerPath = this.paths.local(
          new URL(`${this.paths.directoryURL(dir).href}${entry.name}`),
        );
        let createdFromDb = await this.getCreatedTime(innerPath);
        meta = {
          kind: 'file',
          lastModified: (await this.#adapter.lastModified(innerPath)) ?? null,
          ...(createdFromDb != null
            ? { resourceCreatedAt: createdFromDb }
            : {}),
        } as FileMeta;
      } else {
        meta = { kind: 'directory' };
      }
      let relationship: DirectoryEntryRelationship = {
        links: {
          related:
            entry.kind === 'directory'
              ? this.paths.directoryURL(join(dir, entry.name)).href
              : this.paths.fileURL(join(dir, entry.name)).href,
        },
        meta,
      };

      data.relationships![
        entry.name + (entry.kind === 'directory' ? '/' : '')
      ] = relationship;
    }

    return createResponse({
      body: JSON.stringify({ data }, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.DirectoryListing },
      },
      requestContext,
    });
  }

  private async readFileAsText(
    path: LocalPath,
    opts: { withFallbacks?: true } = {},
  ): Promise<TextFileRef | undefined> {
    return readFileAsText(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      opts,
    );
  }

  private async isIgnored(url: URL): Promise<boolean> {
    return this.#realmIndexUpdater.isIgnored(url);
  }

  // The search: the parsed entry query (the item. membership
  // query + the applied htmlQuery + the sparse fieldset) against the
  // entry projection engine. Same opts threading as `search` —
  // `cardUrls` rides inside the SearchEntryQuery itself.
  public async searchEntries(
    searchEntryQuery: SearchEntryQuery,
    opts?: SearchOpts,
  ): Promise<EntryCollectionDocument> {
    let engineOpts = {
      loadLinks: true as const,
      ...(opts?.cacheOnlyDefinitions ? { cacheOnlyDefinitions: true } : {}),
      ...(opts?.omitIncluded ? { omitIncluded: true } : {}),
      ...(opts?.resolveLinksOnly ? { resolveLinksOnly: true } : {}),
      // `!== undefined` so an explicit priority 0 (system-initiated) survives.
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
      ...(opts?.timings ? { timings: opts.timings } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    };
    return await this.#realmIndexQueryEngine.searchEntries(
      searchEntryQuery,
      engineOpts,
    );
  }

  private async searchEntriesResponse(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    if (request.method !== 'QUERY') {
      return createResponse({
        body: JSON.stringify(buildSearchErrorBody('method must be QUERY')),
        init: {
          status: 400,
          headers: { 'content-type': SupportedMimeType.CardJson },
        },
        requestContext,
      });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch (e: any) {
      return createResponse({
        body: JSON.stringify(
          buildSearchErrorBody(
            `Request body is not valid JSON: ${e?.message ?? e}`,
          ),
        ),
        init: {
          status: 400,
          headers: { 'content-type': SupportedMimeType.CardJson },
        },
        requestContext,
      });
    }

    try {
      let searchEntryQuery = parseSearchEntryQueryFromPayload(payload);
      let duringPrerender = isDuringPrerenderRequest(request);
      // Two bounds hold server-side on the live item leg (never during
      // prerender, never on the prerendered-HTML leg): a hard page-size ceiling
      // and the wall-clock time budget. Both hold for every caller — a page
      // ceiling bounds the result set even when the client card cap was
      // skipped, and a wall-clock cutoff can't live client-side. The realms and
      // concurrency caps stay on the card `@context` surface.
      let itemLegBounded =
        isItemLegSearch(searchEntryQuery.fieldset) && !duringPrerender;
      // Clamp an absent page to the default so the query carries a LIMIT, and
      // an over-maximum explicit one to the maximum (logged, so a short page
      // has an explanation somewhere).
      if (itemLegBounded) {
        searchEntryQuery.itemQuery = applyServerSearchPageBound(
          searchEntryQuery.itemQuery,
        );
      }
      // Classified from the page the query will actually run with — the clamp
      // above has already been applied — because that is the only bound on
      // this read's result count available before it runs, and the link mode
      // has to be settled before the response is built.
      let rowClass = rowClassForPageSize(
        searchEntryQuery.itemQuery.page?.size as number | undefined,
      );
      let resolveLinksOnly =
        this.#decideLinkShape(request, rowClass)?.mode === 'links-only';
      let runSearch = (signal?: AbortSignal) =>
        this.searchEntries(searchEntryQuery, {
          cacheOnlyDefinitions: duringPrerender,
          // Inside a prerender the search skips the `loadLinks`
          // relationship-assembly pass entirely: the host re-resolves every
          // result from its raw card+source file, so the transitive
          // `included[]` expansion is throwaway work in this path.
          omitIncluded: duringPrerender,
          // Live traffic's side of the same question: a prerender takes the
          // line above and skips the pass, while a live search the policy has
          // degraded keeps the pass and drops only the closure it would have
          // assembled.
          resolveLinksOnly,
          ...(signal ? { signal } : {}),
        });
      // Cut an over-budget item-leg search off (408) rather than run it to
      // completion; the signal stops the `loadLinks` fan-out promptly.
      let doc = itemLegBounded
        ? await runWithSearchTimeBudget(runSearch)
        : await runSearch();
      return createResponse({
        body: JSON.stringify(doc, null, 2),
        init: {
          headers: { 'content-type': SupportedMimeType.CardJson },
        },
        requestContext,
      });
    } catch (e) {
      if (e instanceof SearchBoundError) {
        return createResponse({
          body: JSON.stringify(buildSearchErrorBody(e.message, e.status)),
          init: {
            status: e.status,
            headers: { 'content-type': SupportedMimeType.CardJson },
          },
          requestContext,
        });
      }
      if (e instanceof SearchRequestError) {
        return createResponse({
          body: JSON.stringify(buildSearchErrorBody(e.message)),
          init: {
            status: 400,
            headers: { 'content-type': SupportedMimeType.CardJson },
          },
          requestContext,
        });
      }
      throw e;
    }
  }

  private async lint(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let result;
    // eslint does not work well in a browser environment, so our TestRealmAdapter supplies a replaceable stub
    if (this.#adapter.lintStub) {
      result = await this.#adapter.lintStub(request, requestContext);
    } else {
      // Get source from plain text request body
      const source = await request.text();
      const filename =
        decodeLintFilename(request.headers.get(LINT_FILENAME_HEADER)) ??
        'input.gts';
      if (!source || source.trim() === '') {
        return createResponse({
          body: JSON.stringify({
            error: 'Empty source code provided',
          }),
          init: {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
          requestContext,
        });
      }

      let job = await this.#queue.publish<LintResult>({
        jobType: `lint-source`,
        concurrencyGroup: `lint:${this.url}:${Math.random().toString().slice(-1)}`,
        timeout: 30,
        priority: userInitiatedPriority,
        args: { source, filename } satisfies LintArgs,
      });
      result = await job.done;
    }
    return createResponse({
      body: JSON.stringify(result),
      init: {
        headers: { 'content-type': SupportedMimeType.JSON },
      },
      requestContext,
    });
  }

  private async fetchCardTypeSummary(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let results = await this.#realmIndexQueryEngine.fetchCardTypeSummary();

    let doc = makeCardTypeSummaryDoc(results);

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.CardJson },
      },
      requestContext,
    });
  }

  private async getCardDependencies(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let href = new URL(request.url).search.slice(1);
    let payload = parseQuery(href);
    if (!payload.url) {
      return badRequest({
        message: `The request body is missing the url parameter`,
        requestContext,
      });
    }
    let url = Array.isArray(payload.url)
      ? String(payload.url[0])
      : String(payload.url);

    try {
      const deps = await this.#realmIndexQueryEngine.getCardDependencies(
        new URL(url),
      );

      return createResponse({
        body: JSON.stringify(deps, null, 2),
        init: {
          headers: { 'content-type': SupportedMimeType.CardDependencies },
        },
        requestContext,
      });
    } catch (e) {
      if (e instanceof Error) {
        return notFound(request, requestContext);
      }
      throw e;
    }
  }

  private async getDependencies(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let href = new URL(request.url).search.slice(1);
    let payload = parseQuery(href);
    if (!payload.url) {
      return badRequest({
        message: `The request is missing the url query parameter`,
        requestContext,
      });
    }
    let resourceUrl = Array.isArray(payload.url)
      ? String(payload.url[0])
      : String(payload.url);
    let requestedType = payload.type
      ? Array.isArray(payload.type)
        ? String(payload.type[0])
        : String(payload.type)
      : undefined;
    let wantsErrorOnly = requestedType?.endsWith('-error') ?? false;
    let normalizedType = wantsErrorOnly
      ? requestedType?.replace(/-error$/, '')
      : requestedType;
    let acceptedTypes = normalizedType
      ? [normalizedType]
      : ['instance', 'file'];

    let rows = (await query(this.#dbAdapter, [
      `SELECT url, realm_url, deps, type, has_error FROM boxel_index WHERE (url =`,
      param(resourceUrl),
      `OR file_alias =`,
      param(resourceUrl),
      `) AND type IN (`,
      ...acceptedTypes.flatMap((type, index) =>
        index === 0 ? [param(type)] : [',', param(type)],
      ),
      `) AND (is_deleted IS NULL OR is_deleted = FALSE)`,
      ...(wantsErrorOnly ? [`AND has_error = TRUE`] : []),
    ])) as {
      url: string;
      realm_url: string;
      deps: unknown;
      type: string;
      has_error: boolean | null;
    }[];

    let entries = rows.map((row) => ({
      canonicalUrl: row.url,
      realmUrl: ensureTrailingSlash(row.realm_url),
      entryType: row.type,
      hasError: Boolean(row.has_error),
      dependencies: parseDeps(row.deps),
    }));

    let doc = {
      data: entries.map((entry) => ({
        type: 'dependencies',
        id: entry.canonicalUrl,
        attributes: {
          canonicalUrl: entry.canonicalUrl,
          realmUrl: entry.realmUrl,
          entryType: entry.entryType,
          hasError: entry.hasError,
          dependencies: entry.dependencies,
        },
      })),
    };

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
  }

  private async publishability(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Drain any in-flight incremental indexing before reading boxel_index.
    // The publishability report scans indexed instances for private-realm
    // imports + error_doc rows; with CS-11003's deferred indexing on
    // +source POSTs, an immediately-following publishability call could
    // otherwise see a stale snapshot and miss real violations (e.g. a
    // leaky card that just landed but isn't indexed yet).
    //
    // The drain's wait is unbounded: the incremental job it awaits can sit
    // queued behind other realms' work when the worker pool is saturated.
    // The timing log below attributes a slow or empty-looking report to
    // the drain vs. the scan itself.
    let drainStartMs = Date.now();
    let pending = this.incrementalIndexing();
    if (pending) {
      await pending;
    }
    let drainMs = Date.now() - drainStartMs;
    let sourceRealmURL = ensureTrailingSlash(this.url);
    let resourceEntries = new Map<string, ResourceIndexEntry[]>();
    let visibilityCache = new Map<string, RealmVisibility>();
    let remoteRealmBaseCache = new Map<string, URL>();
    let remoteResourceFetches = new Map<
      string,
      Promise<ResourceIndexEntry[]>
    >();

    let instanceRows = (await query(this.#dbAdapter, [
      `SELECT url FROM boxel_index WHERE realm_url =`,
      param(sourceRealmURL),
      `AND type = 'instance'`,
      `AND (is_deleted IS NULL OR is_deleted = FALSE)`,
    ])) as { url: string }[];

    let rootResources = Array.from(new Set(instanceRows.map((row) => row.url)));

    let errorRows = (await query(this.#dbAdapter, [
      `SELECT url, error_doc FROM boxel_index WHERE realm_url =`,
      param(sourceRealmURL),
      `AND type = 'instance'`,
      `AND has_error = TRUE`,
      `AND (is_deleted IS NULL OR is_deleted = FALSE)`,
    ])) as { url: string; error_doc: unknown | null }[];

    let errorViolations: PublishabilityViolation[] = errorRows
      .filter((row) => row.error_doc != null)
      .map((row) => ({
        kind: 'error-document',
        resource: row.url,
        errorDocUrl: row.url,
      }));

    let queue: string[] = [...rootResources];
    let queued = new Set(queue);

    let resolveRealmVisibility = async (realmUrl: string) => {
      let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
      if (visibilityCache.has(normalizedRealmUrl)) {
        return visibilityCache.get(normalizedRealmUrl)!;
      }

      let visibility: RealmVisibility;
      if (normalizedRealmUrl === sourceRealmURL) {
        visibility = await this.visibility();
      } else {
        let permissions = await fetchRealmPermissions(
          this.#dbAdapter,
          new URL(normalizedRealmUrl),
        );
        if (Object.keys(permissions).length === 0) {
          visibility =
            (await fetchRemoteRealmVisibility(normalizedRealmUrl)) ?? 'private';
        } else {
          let usernames = Object.keys(permissions).filter(
            (username) => !username.startsWith('@realm/'),
          );
          if (usernames.includes('*')) {
            visibility = 'public';
          } else if (usernames.includes('users') || usernames.length > 1) {
            visibility = 'shared';
          } else {
            visibility = 'private';
          }
        }
      }

      visibilityCache.set(normalizedRealmUrl, visibility);
      return visibility;
    };

    let fetchRemoteRealmVisibility = async (
      realmUrl: string,
    ): Promise<RealmVisibility | undefined> => {
      try {
        let infoURL = new URL('_info', realmUrl);
        let response = await this.__fetchForTesting(infoURL, {
          method: 'QUERY',
          headers: { Accept: SupportedMimeType.RealmInfo },
        });
        if (!response.ok) {
          return undefined;
        }
        let doc = (await response.json()) as {
          data?: { attributes?: { visibility?: RealmVisibility } };
        };
        return doc.data?.attributes?.visibility;
      } catch (error: any) {
        this.#log.warn(
          `failed to fetch remote realm visibility for ${realmUrl}: ${error?.message ?? error}`,
        );
        return undefined;
      }
    };

    let loadLocalResourceEntries = async (
      resourceUrl: string,
    ): Promise<ResourceIndexEntry[]> => {
      if (isGloballyPublicDependency(resourceUrl)) {
        return [];
      }
      let rows = (await query(this.#dbAdapter, [
        `SELECT url, realm_url, deps, type, has_error FROM boxel_index WHERE (url =`,
        param(resourceUrl),
        `OR file_alias =`,
        param(resourceUrl),
        `) AND type =`,
        param('instance'),
        `AND (is_deleted IS NULL OR is_deleted = FALSE)`,
      ])) as {
        url: string;
        realm_url: string;
        deps: unknown;
        type: ResourceIndexEntry['entryType'];
        has_error: boolean | null;
      }[];

      if (rows.length === 0) {
        return [];
      }

      return rows.map((row) => ({
        canonicalUrl: row.url,
        realmUrl: ensureTrailingSlash(row.realm_url),
        entryType: row.type,
        hasError: Boolean(row.has_error),
        dependencies: parseDeps(row.deps),
      }));
    };

    let tryFetchRemoteEntriesFromBase = async (
      base: URL,
      resourceUrl: string,
    ): Promise<ResourceIndexEntry[] | undefined> => {
      let endpoint = new URL('_dependencies', base);
      endpoint.searchParams.set('url', resourceUrl);
      let response: Response;
      try {
        response = await this.__fetchForTesting(endpoint, {
          headers: { Accept: SupportedMimeType.JSONAPI },
        });
      } catch (error: any) {
        this.#log.warn(
          `failed to fetch remote resource index for ${resourceUrl} via ${endpoint.href}: ${error?.message ?? error}`,
        );
        return undefined;
      }

      if (response.status === 404) {
        return undefined;
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch remote resource index for ${resourceUrl} (${response.status})`,
        );
      }
      let payload = (await response.json()) as {
        data?: Array<{
          id?: string;
          attributes?: {
            canonicalUrl?: string;
            realmUrl?: string;
            entryType?: string;
            hasError?: boolean;
            dependencies?: unknown;
          };
        }>;
      };
      let normalized = (payload.data ?? [])
        .map((resource) => {
          let realmUrl = resource.attributes?.realmUrl;
          let canonicalUrl = resource.attributes?.canonicalUrl ?? resource.id;
          if (!realmUrl || !canonicalUrl) {
            return undefined;
          }

          let dependencies = Array.isArray(resource.attributes?.dependencies)
            ? resource.attributes.dependencies.filter(
                (dep): dep is string => typeof dep === 'string',
              )
            : [];

          let entryType = resource.attributes?.entryType;
          if (entryType !== 'instance' && entryType !== 'file') {
            return undefined;
          }

          return {
            canonicalUrl,
            realmUrl: ensureTrailingSlash(realmUrl),
            entryType,
            hasError: Boolean(resource.attributes?.hasError),
            dependencies,
          };
        })
        .filter((entry): entry is ResourceIndexEntry => Boolean(entry));
      let remoteRealm = normalized[0]?.realmUrl;
      if (remoteRealm) {
        remoteRealmBaseCache.set(remoteRealm, base);
      }
      return normalized;
    };

    let tryFetchUsingKnownRealm = async (resourceUrl: string) => {
      for (let [realmUrl, base] of remoteRealmBaseCache.entries()) {
        if (resourceUrl.startsWith(realmUrl)) {
          return await tryFetchRemoteEntriesFromBase(base, resourceUrl);
        }
      }
      return undefined;
    };

    let fetchRemoteResourceEntries = async (
      resourceUrl: string,
    ): Promise<ResourceIndexEntry[]> => {
      if (isGloballyPublicDependency(resourceUrl)) {
        return [];
      }
      if (remoteResourceFetches.has(resourceUrl)) {
        return remoteResourceFetches.get(resourceUrl)!;
      }
      let fetchPromise = (async () => {
        let existing = await tryFetchUsingKnownRealm(resourceUrl);
        if (existing !== undefined) {
          return existing;
        }
        let parsed = maybeURL(resourceUrl);
        if (!parsed) {
          return [];
        }
        let normalizeToDirectory = (url: URL) =>
          url.pathname.endsWith('/') ? url : new URL('./', url);
        let current = normalizeToDirectory(parsed);
        let visited = new Set<string>();

        while (!visited.has(current.href)) {
          visited.add(current.href);

          let result = await tryFetchRemoteEntriesFromBase(
            current,
            resourceUrl,
          );

          if (result !== undefined) {
            return result;
          }

          let parent = new URL('../', current);

          if (parent.href === current.href) {
            break;
          }

          current = normalizeToDirectory(parent);
        }

        return [];
      })().finally(() => {
        remoteResourceFetches.delete(resourceUrl);
      });
      remoteResourceFetches.set(resourceUrl, fetchPromise);
      return fetchPromise;
    };

    let loadResourceEntries = async (resourceUrl: string) => {
      let entries = await loadLocalResourceEntries(resourceUrl);
      if (
        (entries == null || entries.length === 0) &&
        !isGloballyPublicDependency(resourceUrl) &&
        maybeURL(resourceUrl)
      ) {
        entries = await fetchRemoteResourceEntries(resourceUrl);
      }
      return entries ?? [];
    };

    while (queue.length > 0) {
      let resourceUrl = queue.shift()!;
      queued.delete(resourceUrl);

      if (resourceEntries.has(resourceUrl)) {
        continue;
      }

      let entries = await loadResourceEntries(resourceUrl);

      resourceEntries.set(resourceUrl, entries);
      let canonical = entries[0]?.canonicalUrl;
      if (canonical && !resourceEntries.has(canonical)) {
        resourceEntries.set(canonical, entries);
      }

      if (entries.length === 0) {
        continue;
      }

      for (let entry of entries) {
        await resolveRealmVisibility(ensureTrailingSlash(entry.realmUrl));
        for (let dependency of entry.dependencies) {
          if (!resourceEntries.has(dependency) && !queued.has(dependency)) {
            queue.push(dependency);
            queued.add(dependency);
          }
        }
      }
    }

    await resolveRealmVisibility(sourceRealmURL);

    let result = await analyzeRealmPublishability({
      sourceRealmURL,
      resources: rootResources,
      resourceEntries,
      realmVisibility: visibilityCache,
      isResourceInherentlyPublic: (resourceUrl) =>
        isGloballyPublicDependency(resourceUrl),
    });

    let privateDependencyViolations: PublishabilityViolation[] =
      result.violations.filter(
        (violation) => violation.kind === 'private-dependency',
      );

    let allViolations: PublishabilityViolation[] = [
      ...privateDependencyViolations,
      ...errorViolations,
    ];

    let warningTypes: PublishabilityWarningType[] = [];
    if (privateDependencyViolations.length > 0) {
      warningTypes.push('has-private-dependencies');
    }
    if (errorViolations.length > 0) {
      warningTypes.push('has-error-card-documents');
    }

    let publishable =
      privateDependencyViolations.length === 0 && errorViolations.length === 0;

    this.#log.info(
      `publishability for ${sourceRealmURL}: drained incremental indexing ` +
        `in ${drainMs}ms; ${rootResources.length} instances scanned, ` +
        `${errorRows.length} error rows, ` +
        `${privateDependencyViolations.length} private-dependency violations, ` +
        `publishable=${publishable}`,
    );

    let doc = {
      data: {
        type: 'realm-publishability',
        id: sourceRealmURL,
        attributes: {
          publishable,
          realmURL: sourceRealmURL,
          violations: allViolations,
          warningTypes: warningTypes.length ? warningTypes : undefined,
        },
      },
    };

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
  }

  private async indexingErrors(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Drain any in-flight incremental indexing before reading boxel_index.
    // With CS-11003's deferred indexing on +source POSTs, a caller that
    // pushes a fix and immediately polls this endpoint could otherwise
    // see a stale snapshot — either still reporting an error the just-
    // pushed fix cleared, or missing a fresh failure from the same write.
    // Same hazard publishability() guards against.
    let pending = this.incrementalIndexing();
    if (pending) {
      await pending;
    }
    let sourceRealmURL = ensureTrailingSlash(this.url);

    let rows = (await query(this.#dbAdapter, [
      `SELECT url, type, has_error, error_doc, diagnostics FROM boxel_index WHERE realm_url =`,
      param(sourceRealmURL),
      `AND (is_deleted IS NULL OR is_deleted = FALSE)`,
      `AND (`,
      `  has_error = TRUE`,
      `  OR (`,
      `    jsonb_typeof(diagnostics->'brokenLinks') = 'array'`,
      `    AND jsonb_array_length(diagnostics->'brokenLinks') > 0`,
      `  )`,
      `  OR jsonb_typeof(diagnostics->'frontmatterParseError') = 'object'`,
      `  OR (`,
      `    jsonb_typeof(diagnostics->'toolSchemaErrors') = 'array'`,
      `    AND jsonb_array_length(diagnostics->'toolSchemaErrors') > 0`,
      `  )`,
      `)`,
      `ORDER BY type, url`,
    ])) as {
      url: string;
      type: string;
      has_error: boolean | null;
      error_doc: SerializedError | null;
      diagnostics: Record<string, unknown> | null;
    }[];

    let doc = {
      data: rows.flatMap((row) => {
        let brokenLinks =
          row.diagnostics && Array.isArray(row.diagnostics.brokenLinks)
            ? (row.diagnostics.brokenLinks as unknown[])
            : null;
        let frontmatterParseError =
          row.diagnostics &&
          typeof row.diagnostics.frontmatterParseError === 'object' &&
          row.diagnostics.frontmatterParseError !== null
            ? (row.diagnostics.frontmatterParseError as Record<string, unknown>)
            : null;
        let toolSchemaErrors =
          row.diagnostics && Array.isArray(row.diagnostics.toolSchemaErrors)
            ? (row.diagnostics.toolSchemaErrors as unknown[])
            : null;
        // Source of truth is the row's `has_error` column — the SQL above
        // filters on `has_error = TRUE` OR diagnostic findings
        // (brokenLinks / frontmatterParseError / toolSchemaErrors), so a row
        // can arrive here with `has_error = FALSE` but non-empty diagnostics.
        // We branch on `has_error` to distinguish indexing errors from
        // diagnostic-only rows. Using `row.error_doc != null` here would
        // silently drop any row where `has_error = TRUE` but `error_doc` is NULL.
        let hasError = row.has_error === true;
        // A single boxel_index row can carry more than one independent
        // finding — e.g. a markdown skill with both unparseable frontmatter
        // and a broken card reference in its body. We emit one resource per
        // finding so a consumer filtering by `type` (the JSON CLI, or anyone
        // selecting only 'broken-link') never loses a signal just because it
        // co-occurs with another.
        //
        // 'indexing-error' = row.has_error = TRUE (rendered/indexed badly).
        //   Any brokenLinks ride along as an attribute since the row's
        //   headline is the render failure, not the dead targets.
        // 'broken-link' = the index row is healthy but the rendered card has
        //   dead linksTo/linksToMany targets surfaced by render.meta.
        // 'frontmatter-error' = the index row is healthy but the file's YAML
        //   frontmatter wouldn't parse, so anything it declared was dropped.
        // 'tool-schema-error' = the index row is healthy but one or more of
        //   the skill's frontmatter tools failed schema generation, so those
        //   tools won't be callable until fixed.
        // All classes share the (entryType, url) key; the discriminator lets
        // consumers branch on which attributes to read.
        let baseAttributes = {
          url: row.url,
          entryType: row.type,
          diagnostics: row.diagnostics,
        };
        let findings: {
          type:
            | 'indexing-error'
            | 'broken-link'
            | 'frontmatter-error'
            | 'tool-schema-error';
          attributes: Record<string, unknown>;
        }[] = [];
        if (hasError) {
          let attributes: Record<string, unknown> = {
            ...baseAttributes,
            errorDoc: row.error_doc,
          };
          if (brokenLinks && brokenLinks.length > 0) {
            attributes.brokenLinks = brokenLinks;
          }
          findings.push({ type: 'indexing-error', attributes });
        } else {
          if (frontmatterParseError) {
            findings.push({
              type: 'frontmatter-error',
              attributes: { ...baseAttributes, frontmatterParseError },
            });
          }
          if (toolSchemaErrors && toolSchemaErrors.length > 0) {
            findings.push({
              type: 'tool-schema-error',
              attributes: { ...baseAttributes, toolSchemaErrors },
            });
          }
          if (brokenLinks && brokenLinks.length > 0) {
            findings.push({
              type: 'broken-link',
              attributes: { ...baseAttributes, brokenLinks },
            });
          }
        }
        return findings.map((finding) => ({
          type: finding.type,
          // `(type, url)` is the boxel_index PK partition; encoding both
          // keeps the JSON:API resource id unique when the same URL fails
          // as both 'instance' and 'file'. When a single row yields more
          // than one finding we append the finding class too, so the two
          // resources don't collide on a shared id.
          id:
            findings.length > 1
              ? `${row.type}::${row.url}::${finding.type}`
              : `${row.type}::${row.url}`,
          attributes: finding.attributes,
        }));
      }),
    };

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
  }

  private async realmMtimes(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let mtimes: { [path: string]: number } = {};
    let traverse = async (currentPath = '') => {
      const entries = this.#adapter.readdir(currentPath);

      for await (const entry of entries) {
        let innerPath = join(currentPath, entry.name);
        let innerURL =
          entry.kind === 'directory'
            ? this.paths.directoryURL(innerPath)
            : this.paths.fileURL(innerPath);
        if (await this.isIgnored(innerURL)) {
          continue;
        }
        if (entry.kind === 'directory') {
          await traverse(innerPath);
        } else if (entry.kind === 'file') {
          let mtime = await this.#adapter.lastModified(innerPath);
          if (mtime != null) {
            mtimes[innerURL.href] = mtime;
          }
        }
      }
    };

    await traverse();

    return createResponse({
      body: JSON.stringify(
        {
          data: {
            id: this.url,
            type: 'mtimes',
            attributes: {
              mtimes,
            },
          },
        },
        null,
        2,
      ),
      init: {
        headers: { 'content-type': SupportedMimeType.Mtimes },
      },
      requestContext,
    });
  }

  private async getRealmPermissions(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let permissions = await fetchRealmPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );

    let doc = {
      data: {
        id: this.url,
        type: 'permissions',
        attributes: { permissions },
      },
    };
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.Permissions },
      },
      requestContext,
    });
  }

  private async patchRealmPermissions(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let json: { data?: { attributes?: { permissions?: RealmPermissions } } };
    try {
      json = await request.json();
    } catch (e: any) {
      return badRequest({
        message: `The request body was not json: ${e.message}`,
        requestContext,
      });
    }
    let patch = json.data?.attributes?.permissions;
    if (!patch) {
      return badRequest({
        message: `The request body was missing permissions`,
        requestContext,
      });
    }
    try {
      assertRealmPermissions(patch);
    } catch (e: any) {
      return badRequest({
        message: `The request body does not specify realm permissions correctly: ${e.message}`,
        requestContext,
      });
    }

    let currentPermissions = await fetchRealmPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );
    for (let [user, permissions] of Object.entries(patch)) {
      if (currentPermissions[user]?.includes('realm-owner')) {
        return badRequest({
          message: `cannot modify permissions of the realm owner ${user}`,
          requestContext,
        });
      }
      if (permissions?.includes('realm-owner')) {
        return badRequest({
          message: `cannot create new realm owner ${user}`,
          requestContext,
        });
      }
    }

    await insertPermissions(this.#dbAdapter, new URL(this.url), patch);
    // CS-11178: `RealmInfo.visibility` is derived from `realm_permissions`
    // and memoized into `#cachedRealmInfo` by `parseRealmInfo`. Without
    // this invalidation a PATCH on this replica leaves the *local*
    // `_info` response stale until the next index swap, and a PATCH on
    // any peer replica leaves *every* replica's `_info` response stale
    // until process restart — the same multi-replica staleness pattern
    // CS-11126 closed at the auth layer, surviving one layer up.
    // Reuses the existing realm_index_updated channel: the peer listener
    // calls `clearRealmIndexCaches()` which drops `#cachedRealmInfo`
    // (exactly what we need) and `#inFlightSearch` (a no-op when empty;
    // permission PATCHes are admin-rare so the over-invalidation is
    // negligible).
    await this.clearRealmIndexCachesAndBroadcast();
    // Tell each affected user their accessible-realm set changed so a running
    // session re-derives it from `_realm-auth` (which reads the permissions
    // written just above) without a reload. Nothing else notifies a grantee:
    // the index_updated broadcast above is server-to-server only.
    await this.notifyRealmsListUpdated(Object.keys(patch));
    return await this.getRealmPermissions(request, requestContext);
  }

  // Notify each affected user that their set of accessible realms changed, so
  // a running session re-derives it from `_realm-auth` without a reload.
  // Delivered into the user's session DM room via the shared `sendEvent`
  // helper, which no-ops when the user has no session room and self-heals a
  // stale one. Best-effort per user: a delivery failure must never roll back
  // the grant that already committed, so one user's error is logged and the
  // rest still run.
  private async notifyRealmsListUpdated(users: string[]): Promise<void> {
    let sendEvent = createSendEvent({
      matrixClient: this.#matrixClient,
      dbAdapter: this.#dbAdapter,
    });
    for (let user of users) {
      try {
        await sendEvent(user, REALMS_LIST_UPDATED_EVENT_TYPE);
      } catch (e) {
        this.#log.error(
          `failed to notify ${user} that their realms list changed`,
          e,
        );
      }
    }
  }

  private async getLastPublishedAt(): Promise<
    string | Record<string, string> | null
  > {
    try {
      // First check if this realm is a published realm
      let publishedRealmData = await this.queryPublishedRealm();
      if (publishedRealmData) {
        return publishedRealmData.last_published_at;
      }

      // If not published, check if this is a source realm with published versions
      let publishedVersions = await this.querySourceRealmPublications();
      if (publishedVersions.length > 0) {
        return (
          Object.fromEntries(
            publishedVersions.map((p) => [
              p.published_realm_url,
              p.last_published_at,
            ]),
          ) ?? null
        );
      }

      return null; // Never published
    } catch (error) {
      this.#log.warn(`Failed to get lastPublishedAt: ${error}`);
      return null;
    }
  }

  private async queryPublishedRealm(): Promise<{
    last_published_at: string;
  } | null> {
    try {
      let results = (await query(this.#dbAdapter, [
        `SELECT last_published_at FROM realm_registry WHERE kind = 'published' AND url =`,
        param(this.url),
      ])) as { last_published_at: string }[];

      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.#log.warn(`Failed to query published realm: ${error}`);
      return null;
    }
  }

  private async querySourceRealmPublications(): Promise<
    { published_realm_url: string; last_published_at: string }[]
  > {
    try {
      // Phase 4: read from realm_registry; aliases keep callers stable.
      // ORDER BY pins the result order so that
      // `getLastPublishedAt()` -> `Object.fromEntries(rows.map(...))` ->
      // `JSON.stringify(realmInfo)` produces a *deterministic* hash for
      // the same logical state. Without it, two realm-server instances
      // (or the same instance after a restart) can hash the same data
      // to different ETag bases purely on Postgres row-order luck —
      // missed-304 storms instead of cache hits.
      let results = (await query(this.#dbAdapter, [
        `SELECT url AS published_realm_url, last_published_at FROM realm_registry WHERE kind = 'published' AND source_url =`,
        param(this.url),
        `ORDER BY url`,
      ])) as { published_realm_url: string; last_published_at: string }[];

      return results;
    } catch (error) {
      this.#log.warn(`Failed to query source realm publications: ${error}`);
      return [];
    }
  }

  // Reads showAsCatalog / publishable from realm_metadata. Both columns
  // are nullable; missing rows or query failures return null/null,
  // matching the pre-CS-10053 behavior of "absent in sidecar".
  private async getRealmMetadata(): Promise<{
    showAsCatalog: boolean | null;
    publishable: boolean | null;
  }> {
    try {
      // Both columns are declared `boolean | null` and consumers compare them
      // as booleans, so coerce them: adapters are free to hand back a
      // driver-native spelling for a boolean column — postgres yields real
      // booleans, SQLite yields 1/0 — and an uncoerced 1 fails every
      // `=== true` check downstream while still looking truthy.
      let results = (await query(
        this.#dbAdapter,
        [
          `SELECT show_as_catalog, publishable FROM realm_metadata WHERE url =`,
          param(this.url),
        ],
        { show_as_catalog: 'BOOLEAN', publishable: 'BOOLEAN' },
      )) as {
        show_as_catalog: boolean | null;
        publishable: boolean | null;
      }[];
      if (results.length === 0) {
        return { showAsCatalog: null, publishable: null };
      }
      return {
        showAsCatalog: results[0].show_as_catalog,
        publishable: results[0].publishable,
      };
    } catch (error) {
      this.#log.warn(`Failed to query realm metadata: ${error}`);
      return { showAsCatalog: null, publishable: null };
    }
  }

  // created_at / updated_at come from realm_registry rather than
  // realm_metadata: every mounted realm has a registry row — source,
  // published, and bootstrap realms alike — while realm_metadata rows only
  // exist for realms that went through the create-realm or publish flow.
  // Kept separate from getRealmMetadata() (rather than joined into it) so a
  // realm that has one row but not the other still gets whatever it does
  // have; a join in either direction drops the columns from the missing side.
  private async getRegistryTimestamps(): Promise<{
    createdAt: string | null;
    updatedAt: string | null;
  }> {
    try {
      let results = (await query(this.#dbAdapter, [
        `SELECT created_at, updated_at FROM realm_registry WHERE url =`,
        param(this.url),
      ])) as {
        // pg returns a `timestamp` column as a native Date; sqlite (used
        // in host tests) stores/returns it as text. Normalize both to an
        // ISO string below so `createdAt`/`updatedAt` honor their
        // declared types.
        created_at: string | Date | null;
        updated_at: string | Date | null;
      }[];
      if (results.length === 0) {
        return { createdAt: null, updatedAt: null };
      }
      return {
        createdAt: toISOStringOrNull(results[0].created_at),
        updatedAt: toISOStringOrNull(results[0].updated_at),
      };
    } catch (error) {
      this.#log.warn(`Failed to query realm registry timestamps: ${error}`);
      return { createdAt: null, updatedAt: null };
    }
  }

  // Advance `realm_registry.updated_at` when this realm's content changes, so
  // the workspace chooser's "Updated" footer tracks real activity. Scoped to
  // `kind = 'source'`: source rows are the only ones a user writes to, while
  // published rows carry publish-time semantics via `last_published_at` and
  // bootstrap rows never change. Called from the incremental-index invalidation
  // hook — once per write batch, not once per file — so the cost is one cheap
  // single-row UPDATE per write. Best-effort: a failed touch must not fail the
  // index that triggered it. The surrounding index swap already dropped
  // `#cachedRegistryTimestamps` (via `invalidateCachedRealmInfo`), so the next
  // `getRegistryTimestamps` re-reads the advanced value.
  private async touchSourceRealmUpdatedAt(): Promise<void> {
    try {
      await query(this.#dbAdapter, [
        `UPDATE realm_registry SET updated_at = now() WHERE url =`,
        param(this.url),
        `AND kind = 'source'`,
      ]);
    } catch (error) {
      this.#log.warn(
        `Failed to advance realm_registry.updated_at for ${this.url}: ${error}`,
      );
    }
  }

  // Cards / files / definitions for the tile-metadata row (see
  // workspace-chooser). "Definitions" are the modules that can declare a card
  // or field (.gts/.ts/.gjs/.js); "files" is everything else — assets, docs,
  // standalone data.
  //
  // Counted per distinct url, not per row, because a card instance produces
  // BOTH an `instance` row and a `file` row at the same url (its `.json`).
  // Counting rows would put every card into the file count as well, so a
  // realm of 24 cards and 3 assets would report 27 files.
  //
  // Scoped by `is_deleted` alone, with no generation predicate: deletions are
  // tombstoned via `is_deleted`, while `boxel_index.generation` is a
  // last-touched watermark that an incremental index only bumps on the rows it
  // rewrote. Pinning `generation = current_generation` would count just the
  // files touched by the most recent index pass — on a realm that has had any
  // incremental index that is a handful of rows, not its contents. This
  // matches how the query engine scopes a live search (see
  // `index-query-engine.ts`).
  //
  // One query rather than three: they share a scan, and the counts are only
  // ever consumed together. Returns nulls rather than throwing on a query
  // failure — boxel_index is absent from the sqlite adapter the host tests use,
  // and a gap here should leave the tile without a stats row, not fail the
  // request. Callers reach this through the memoizing `getIndexCounts()`.
  private async queryIndexCounts(): Promise<RealmIndexCounts> {
    // Spelled as SUM(CASE ...) rather than COUNT(*) with a `::int` cast: the
    // cast is Postgres-only syntax. 1/0 flags rather than booleans for the
    // same reason — sqlite has no boolean type.
    let modulePredicate = `(bi.url LIKE '%.gts' OR bi.url LIKE '%.ts' OR bi.url LIKE '%.gjs' OR bi.url LIKE '%.js')`;
    try {
      let results = (await query(this.#dbAdapter, [
        `SELECT
           SUM(CASE WHEN has_instance = 1 THEN 1 ELSE 0 END) AS card_count,
           SUM(CASE WHEN has_instance = 0 AND is_module = 1 THEN 1 ELSE 0 END) AS definition_count,
           SUM(CASE WHEN has_instance = 0 AND is_module = 0 THEN 1 ELSE 0 END) AS file_count
         FROM (
           SELECT
             MAX(CASE WHEN bi.type = 'instance' THEN 1 ELSE 0 END) AS has_instance,
             MAX(CASE WHEN ${modulePredicate} THEN 1 ELSE 0 END) AS is_module
           FROM boxel_index bi
           WHERE bi.realm_url =`,
        param(this.url),
        `AND (bi.is_deleted = FALSE OR bi.is_deleted IS NULL)
           GROUP BY bi.url
         ) per_url`,
      ])) as {
        card_count: number | string | null;
        definition_count: number | string | null;
        file_count: number | string | null;
      }[];
      let row = results[0];
      if (!row) {
        return { cardCount: null, fileCount: null, definitionCount: null };
      }
      // SUM over zero rows is NULL in both adapters, and pg can hand back a
      // bigint as a string — coalesce to 0 and normalize to a number so the
      // UI's `count === 0` checks behave.
      return {
        cardCount: Number(row.card_count ?? 0),
        fileCount: Number(row.file_count ?? 0),
        definitionCount: Number(row.definition_count ?? 0),
      };
    } catch (error) {
      this.#log.warn(`Failed to query realm index counts: ${error}`);
      return { cardCount: null, fileCount: null, definitionCount: null };
    }
  }

  // CS-10054: read host routing rules from the indexed RealmConfig card.
  // The `instance` field is `linksTo(CardDef)`, so the indexed
  // searchDoc flattens each rule's link as `{ id, ...flattened
  // linked-card attrs }`. We only need the absolute `id` here.
  // Returns absolute URLs. A rule may instead declare a redirect
  // (`redirectTo` + optional `statusCode`); those surface as redirect
  // entries in the map.
  async getHostRoutingMap(): Promise<HostRoutingRule[]> {
    if (this.#cachedHostRoutingMap) {
      return this.#cachedHostRoutingMap;
    }
    let realmConfigCardURL = new URL(
      this.paths.fileURL('realm.json').href.replace(/\.json$/, ''),
    );
    try {
      let indexEntry =
        await this.#realmIndexQueryEngine.instance(realmConfigCardURL);
      if (indexEntry?.type !== 'instance') {
        return (this.#cachedHostRoutingMap = []);
      }
      let rules = (indexEntry.searchDoc ?? {}).hostRoutingRules;
      if (!Array.isArray(rules)) {
        return (this.#cachedHostRoutingMap = []);
      }
      let map = rules.flatMap((rule): HostRoutingRule[] => {
        if (!rule || typeof rule !== 'object') return [];
        let path = (rule as Record<string, unknown>).path;
        let instance = (rule as Record<string, unknown>).instance;
        if (typeof path !== 'string') return [];
        // Normalize a rule authored with a trailing slash ('/pricing/') to
        // its canonical slash-free form ('/pricing'). Request paths are
        // matched slash-insensitively (RealmPaths.local strips trailing
        // slashes), so an un-normalized '/pricing/' rule would never match;
        // normalizing here also feeds the correct canonical form to the
        // serve-index redirect and the client-side routing map. Shared with
        // the editor's duplicate detection so a '/pricing' + '/pricing/'
        // collision is flagged there. The realm-root rule '/' is preserved.
        let normalizedPath = normalizeRoutingPath(path);
        let redirectTo = (rule as Record<string, unknown>).redirectTo;
        if (typeof redirectTo === 'string' && redirectTo.trim()) {
          // A redirect rule. A rule carrying both `redirectTo` and
          // `instance` is only reachable by hand-editing realm.json —
          // the editor clears one when the other is chosen — and the
          // redirect wins as the more explicit declaration.
          //
          // Unless it doesn't hold up: an unusable target falls through
          // to the instance below rather than taking the rule down with
          // it, so a typo in a hand-added `redirectTo` leaves a route
          // that was serving a card still serving it. With no usable
          // instance either, the rule drops and the path resolves as if
          // unrouted.
          let target = redirectTo.trim();
          let warning = validateRedirectTarget(target);
          if (warning) {
            this.#log.warn(
              `ignoring invalid redirect target ${JSON.stringify(
                target,
              )} on host routing rule for path "${normalizedPath}": ${warning}`,
            );
          } else {
            let statusCode =
              parseRedirectStatusCode(
                (rule as Record<string, unknown>).statusCode,
              ) ?? DEFAULT_REDIRECT_STATUS;
            return [{ path: normalizedPath, redirectTo: target, statusCode }];
          }
        }
        if (!instance || typeof instance !== 'object') return [];
        let id = (instance as Record<string, unknown>).id;
        if (typeof id !== 'string') return [];
        let idURL: URL;
        try {
          idURL = new URL(id);
        } catch {
          return [];
        }
        // Defensive same-realm guard. The project spec restricts
        // routing rules to cards within the same realm; CS-10052
        // enforces that in the UI but the file is hand-editable, so
        // the read path filters too. Without this guard a realm owner
        // could point `instance` at a private realm's card and the
        // serve-index cardURL rewrite would surface its prerendered
        // HTML through their public realm's routed path. `inRealm`
        // is URL-aware, so neighbouring realms with shared prefixes
        // (`/realm-evil/` vs `/realm/`) and trailing-slash variance
        // are handled correctly.
        if (!this.paths.inRealm(idURL)) {
          this.#log.warn(
            `dropping host routing rule for path "${normalizedPath}" — target ${id} is outside this realm`,
          );
          return [];
        }
        return [{ path: normalizedPath, id }];
      });
      // Drop redirect rules that chain back on themselves. Serving them
      // would bounce the client between URLs until it gives up, and a
      // permanent 301 would keep doing so from cache after the config is
      // fixed. Dropped, the path resolves like any unrouted one. Only
      // the rules forming the ring go — a rule pointing INTO it resolves
      // once the ring is gone.
      let looping = new Set(findRedirectCycles(map));
      if (looping.size > 0) {
        for (let path of looping) {
          this.#log.warn(
            `dropping host routing rule for path "${path}" — its redirect target loops back to itself`,
          );
        }
        map = map.filter(
          (rule) => !(isRedirectRoutingRule(rule) && looping.has(rule.path)),
        );
      }
      return (this.#cachedHostRoutingMap = map);
    } catch (e) {
      this.#log.warn(
        `failed to read host routing map from RealmConfig card: ${e}`,
      );
      // Don't cache a transient read failure — leave `null` so the next
      // call retries the index query.
      return [];
    }
  }

  // Memoized, and coalesced while cold. The assignment lands after the
  // await, so without an in-flight promise every concurrent caller on a cold
  // cache runs `parseRealmInfo()` in full — three DB reads each. That matters
  // because `clearRealmIndexCaches()` nulls the cache on every
  // `realm_index_updated` NOTIFY, so on a busy realm the herd re-forms after
  // each index swap, and the card+json read path consults this on every
  // request. Cleared on rejection so a transient failure isn't pinned.
  async getRealmInfo(): Promise<RealmInfo> {
    return (await this.#parsedRealmInfo()).info;
  }

  // The realm's settings, as `realmConfig()` answers with them. A realm that
  // declares none has an empty map rather than nothing, so a program naming a
  // setting is told this realm has no such setting rather than that the host
  // supplied no configuration at all — two different defects with two
  // different fixes.
  //
  // A copy per caller, for the reason the builtins copy a value on its way
  // into a program: what comes back is put into a card resource and carried
  // through a serializer, and one in-place write anywhere along there would
  // change what every later operation in this process reads. The map is small
  // and this is once per batch.
  async getRealmConfig(): Promise<Record<string, JsonValue>> {
    return structuredClone((await this.#parsedRealmInfo()).config);
  }

  // Both halves of one parse, which is why they are read together rather than
  // each through its own accessor: `clearRealmIndexCaches()` nulls the cache
  // on every index swap, so a settings read that primed the cache and then
  // reached for the field would answer an empty map for a realm that has
  // settings whenever a swap landed in between.
  async #parsedRealmInfo(): Promise<{
    info: RealmInfo;
    config: Record<string, JsonValue>;
  }> {
    if (this.#cachedRealmInfo && this.#cachedRealmConfig) {
      return { info: this.#cachedRealmInfo, config: this.#cachedRealmConfig };
    }
    if (!this.#realmInfoPromise) {
      let parse = (async () => {
        // Captured before the read begins, so an invalidation that lands while
        // it is in flight is visible when it finishes.
        let generation = this.#realmInfoGeneration;
        // The parse hands back the two halves already apart; this only
        // memoizes them. The hash covers the served half alone, which is
        // exactly the bytes a response carries — so editing a setting does not
        // invalidate every card's cached representation in the realm.
        let { info, config } = await this.parseRealmInfo();
        let settings = config ?? {};
        if (generation === this.#realmInfoGeneration) {
          this.#cachedRealmInfo = info;
          this.#cachedRealmConfig = settings;
          this.#cachedRealmInfoHash = computeContentHash(JSON.stringify(info));
        }
        // Answered either way: this is the realm as the caller asking for it
        // found it, which is what every reader of a memoized parse gets. What
        // the check above prevents is that reading outliving the request, by
        // becoming the answer given to everyone after it.
        return { info, config: settings };
      })();
      this.#realmInfoPromise = parse;
      // Clears the slot only while this parse still owns it. An invalidation
      // replaces the slot with nothing and a later caller puts its own parse
      // there; a bare clear here would drop that one instead, costing a
      // redundant read of the config document.
      void parse
        .catch(() => {})
        .finally(() => {
          if (this.#realmInfoPromise === parse) {
            this.#realmInfoPromise = undefined;
          }
        });
    }
    return await this.#realmInfoPromise;
  }

  // Snapshot of the realm-info hash used as part of the card+json ETag.
  // Returns undefined if the cache has been invalidated since the last
  // `getRealmInfo()` call — callers should call `getRealmInfo()` first
  // (which we already do on every getCard request) to refresh the hash.
  private getCachedRealmInfoHash(): string | undefined {
    return this.#cachedRealmInfoHash ?? undefined;
  }

  // Public so the publish/unpublish handlers can invalidate the SOURCE
  // realm's cache when a derivative is (un)published. The source
  // realm's `lastPublishedAt` map (which feeds into `RealmInfo` and
  // therefore the card+json ETag's hash) is computed from
  // `realm_registry` rows where `source_url = this.url`; publishing
  // X' from X bumps that map but doesn't otherwise touch the
  // RealmConfig card or `realm_metadata`, so without this hook a 304
  // would be served against the *pre-publish* hash forever.
  invalidateCachedRealmInfo(): void {
    this.#realmInfoGeneration++;
    this.#cachedRealmInfo = null;
    this.#cachedRealmConfig = null;
    this.#cachedRealmInfoHash = null;
    this.#cachedRegistryTimestamps = null;
    this.#cachedIndexCounts = null;
    // Drop any in-flight aggregate too, so a request that overlapped the swap
    // doesn't repopulate the cache with pre-swap counts.
    this.#indexCountsPromise = null;
    // And the in-flight parse, for the same reason and one more: a caller
    // arriving after this point would otherwise be handed the reading that
    // parse is already holding, from before the swap. A stale realm name
    // corrects itself on the next read; a stale setting is staged into a card
    // file by whichever operation read it, and does not.
    this.#realmInfoPromise = undefined;
  }

  // The realm's config document, read as the two things it holds: the info
  // every realm-info route serves, and the settings only the operation runtime
  // reads. They are returned apart rather than as one object a caller narrows,
  // because three of this class's own routes stamp what comes back straight
  // into a response — so a settings map that arrived inside `info` would be on
  // the wire by default and stay off it only by each caller remembering.
  private async parseRealmInfo(): Promise<{
    info: RealmInfo;
    config: Record<string, JsonValue> | undefined;
  }> {
    let [lastPublishedAt, metadata] = await Promise.all([
      this.getLastPublishedAt(),
      this.getRealmMetadata(),
    ]);
    let realmInfo: RealmInfo = {
      name: 'Unnamed Workspace',
      backgroundURL: null,
      iconURL: null,
      showAsCatalog: metadata.showAsCatalog,
      visibility: await this.visibility(),
      realmUserId: ensureFullMatrixUserId(
        this.#matrixClient.getUserId()! || this.#matrixClient.username,
        this.#matrixClient.matrixURL.href,
      ),
      publishable: metadata.publishable,
      lastPublishedAt,
      includePrerenderedDefaultRealmIndex: null,
    };

    // Overlay from the RealmConfig card file at /realm.json on disk. The
    // file is the source of truth — card writes update it, publish
    // copySync's it from the source realm — and exists before the indexer
    // ever processes it. Reading from disk closes the gap during indexing,
    // when /_info can fire mid-pass via the prerender host's cardRender:
    // parseRealmInfo's overlay below queries `boxel_index` (without
    // useWorkInProgressIndex), which can't see entries written to
    // boxel_index_working until `batch.done()` swaps; without this file
    // overlay, the very first /_info during a from-scratch pass falls
    // back to "Unnamed Workspace", the prerender host caches that on its
    // RealmResource (`fetchInfo` short-circuits if `info` is set), and
    // /index's prerendered head HTML carries the wrong og:title.
    let realmConfigCardURL = new URL(
      this.paths.fileURL('realm.json').href.replace(/\.json$/, ''),
    );
    try {
      let cardFilePath: LocalPath = this.paths.local(
        this.paths.fileURL('realm.json'),
      );
      let cardFile = await this.readFileAsText(cardFilePath, undefined);
      if (cardFile?.content) {
        let cardDoc = JSON.parse(cardFile.content) as {
          data?: { attributes?: Record<string, unknown> };
        };
        let attrs = (cardDoc?.data?.attributes ?? {}) as Record<
          string,
          unknown
        >;
        let cardInfo = (attrs.cardInfo ?? {}) as Record<string, unknown>;
        if (typeof cardInfo.name === 'string') {
          realmInfo.name = cardInfo.name;
        }
        if ('backgroundURL' in attrs) {
          realmInfo.backgroundURL =
            typeof attrs.backgroundURL === 'string'
              ? attrs.backgroundURL
              : null;
        }
        if ('iconURL' in attrs) {
          realmInfo.iconURL =
            typeof attrs.iconURL === 'string' ? attrs.iconURL : null;
        }
        // Opt-in field: only an explicit `true` is meaningful (every
        // consumer checks `=== true`). An unset BooleanField serializes
        // as `false` once the card is indexed, so collapse anything but
        // `true` to null — /_info then reports the same "not opted in"
        // value whether or not the card has been indexed yet.
        if (attrs.includePrerenderedDefaultRealmIndex === true) {
          realmInfo.includePrerenderedDefaultRealmIndex = true;
        }
        if ('config' in attrs) {
          assignRealmConfig(realmInfo, attrs.config, this.#log);
        }
      }
    } catch (e) {
      this.#log.warn(`failed to read RealmConfig card from disk: ${e}`);
    }

    // Final overlay from the indexed RealmConfig card. Wins over the file
    // read above so that any post-indexing transformations (search-doc
    // shape, etc.) take precedence in steady state. Uses instance() rather
    // than cardDocument() to avoid recursing through attachRealmInfo →
    // getRealmInfo → parseRealmInfo.
    try {
      let indexEntry =
        await this.#realmIndexQueryEngine.instance(realmConfigCardURL);
      if (indexEntry?.type === 'instance') {
        let attrs = (indexEntry.instance.attributes ?? {}) as Record<
          string,
          unknown
        >;
        let cardInfo = (attrs.cardInfo ?? {}) as Record<string, unknown>;
        if (typeof cardInfo.name === 'string') {
          realmInfo.name = cardInfo.name;
        }
        if ('backgroundURL' in attrs) {
          realmInfo.backgroundURL =
            typeof attrs.backgroundURL === 'string'
              ? attrs.backgroundURL
              : null;
        }
        if ('iconURL' in attrs) {
          realmInfo.iconURL =
            typeof attrs.iconURL === 'string' ? attrs.iconURL : null;
        }
        // See the disk-overlay note above: collapse non-`true` to null so
        // an unset field (which indexes as `false`) doesn't flip /_info.
        if (attrs.includePrerenderedDefaultRealmIndex === true) {
          realmInfo.includePrerenderedDefaultRealmIndex = true;
        }
        if ('config' in attrs) {
          assignRealmConfig(realmInfo, attrs.config, this.#log);
        }
      }
    } catch (e) {
      this.#log.warn(`failed to read RealmConfig card from index: ${e}`);
    }

    let { config, ...info } = realmInfo;
    return { info, config };
  }

  // RealmInfo plus the realm-lifecycle timestamps, for the realm server's batch
  // `/_federated-info` — what the host loads once at boot for every realm.
  // Public so that handler can reach it. Index counts are NOT included: they
  // are the expensive half and only a favorited realm's tile renders them, so
  // they have their own route (see `getIndexCounts`).
  //
  // Deliberately not folded into `parseRealmInfo()`/`getRealmInfo()`: that
  // result is embedded in every card response's `meta.realmInfo` and hashed
  // into the card+json ETag, so `updated_at` — which `touchSourceRealmUpdatedAt`
  // advances on every write to a source realm — would invalidate every card's
  // cached representation in the realm each time one card changed.
  async getDetailedRealmInfo(): Promise<RealmInfo> {
    let [info, timestamps] = await Promise.all([
      this.getRealmInfo(),
      this.getCachedRegistryTimestamps(),
    ]);
    return { ...info, ...timestamps };
  }

  private async getCachedRegistryTimestamps(): Promise<{
    createdAt: string | null;
    updatedAt: string | null;
  }> {
    if (!this.#cachedRegistryTimestamps) {
      this.#cachedRegistryTimestamps = await this.getRegistryTimestamps();
    }
    return this.#cachedRegistryTimestamps;
  }

  // Cards / files / definitions for the workspace-chooser favorite tiles.
  // Served by `/_federated-index-counts` and requested lazily, only for the
  // realms whose tiles render a stats row — the underlying query aggregates
  // every index row in the realm, so it must not sit on a path the host walks
  // for every realm at boot. Memoized and dropped on index swap, so a realm
  // whose tile is re-rendered repeatedly pays the aggregate once per
  // generation. Public so the route handler can reach it.
  async getIndexCounts(): Promise<RealmIndexCounts> {
    if (this.#cachedIndexCounts) {
      return this.#cachedIndexCounts;
    }
    if (!this.#indexCountsPromise) {
      this.#indexCountsPromise = this.queryIndexCounts().finally(() => {
        this.#indexCountsPromise = null;
      });
    }
    let counts = await this.#indexCountsPromise;
    // Don't memoize a failed query — `queryIndexCounts` returns an all-`null`
    // triple on error, and caching that would suppress this realm's counts
    // until its next index swap. Leaving it uncached lets the next request
    // retry; a real (even all-zero) result is safe to memoize.
    if (
      counts.cardCount !== null ||
      counts.fileCount !== null ||
      counts.definitionCount !== null
    ) {
      this.#cachedIndexCounts = counts;
    }
    return counts;
  }

  // Serves the plain `RealmInfo`, NOT `getDetailedRealmInfo`. This route is
  // fanned out to internally: the realm server's `/_catalog-realms` handler
  // issues one `_info` per publicly-readable realm and silently drops any
  // realm whose response isn't a 200, then caches that list for the life of
  // the process. Adding per-request index aggregation here put that cold
  // fan-out at risk for no benefit — the workspace chooser reads its tile
  // metadata from `/_federated-info`, which does serve the detailed variant.
  private async realmInfo(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let { info: realmInfo } = await this.parseRealmInfo();

    let doc = {
      data: {
        id: this.url,
        type: 'realm-info',
        attributes: realmInfo,
      },
    };
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.RealmInfo },
      },
      requestContext,
    });
  }

  // Builds a card write's response out of the document just serialized to
  // disk, instead of reading the write back out of the index.
  //
  // This is what a write from a prerender tab answers with. Such a caller
  // holds a prerender render slot for as long as its write is open — and, on
  // the queued-command path, a queue worker as well — while the index read
  // would await the `incremental-index` job the write enqueues, a job that
  // needs the very slot and worker the caller is holding. Answering from the
  // serialization keeps the write independent of indexing; pairing it with
  // `waitForIndex: false` on the write is what makes the enqueue deferred
  // rather than awaited.
  //
  // The echo carries what a saving client merges back: the assigned id, the
  // self link, `lastModified`, and the realm's `realmInfo`. It does not carry
  // computed fields, resolved links, or the joined `meta.screenshots` — only
  // the index knows those. A caller that needs them reads the instance again
  // once indexing has settled.
  private async serializedInstanceEcho(
    serialization: LooseSingleCardDocument,
    instanceURL: string,
    lastModified: number | null,
  ): Promise<SingleCardDocument> {
    let realmInfo = await this.getRealmInfo();
    return merge({}, serialization, {
      data: {
        id: instanceURL,
        links: { self: instanceURL },
        meta: {
          realmURL: this.url,
          realmInfo,
          ...(lastModified != null ? { lastModified } : {}),
        },
      },
    }) as SingleCardDocument;
  }

  private async fileSerialization(
    doc: LooseSingleCardDocument,
    relativeTo: URL,
  ): Promise<LooseSingleCardDocument> {
    let absoluteCodeRef = codeRefWithAbsoluteIdentifier(
      doc.data.meta.adoptsFrom,
      relativeTo,
      undefined,
      this.#virtualNetwork,
    ) as ResolvedCodeRef;
    let definition =
      await this.#definitionLookup.lookupDefinition(absoluteCodeRef);
    if (!definition) {
      throw new Error(
        `Could not find card definition for: ${JSON.stringify(absoluteCodeRef)}`,
      );
    }

    return await serialize({
      doc,
      definition,
      relativeTo,
      definitionLookup: this.#definitionLookup,
      virtualNetwork: this.#virtualNetwork,
    });
  }

  private async startFileWatcher() {
    await this.#adapter.subscribe(async (data) => {
      let tracked = this.getTrackedWrite(data);
      if (!tracked || tracked.isTracked) {
        return;
      }

      let localPath = this.paths.local(tracked.url);
      this.invalidateCache(localPath);

      if (hasExecutableExtension(localPath)) {
        await this.#definitionLookup.invalidate(tracked.url.href);
      }

      this.broadcastRealmEvent({
        eventName: 'update',
        ...('added' in data
          ? { added: [data.added] }
          : 'updated' in data
            ? { updated: [data.updated] }
            : { removed: [data.removed] }),
        realmURL: this.url,
      } as UpdateRealmEventContent);
      this.#updateItems.push({
        operation: ('added' in data
          ? 'add'
          : 'updated' in data
            ? 'update'
            : 'removed') as UpdateItem['operation'],
        url: tracked.url,
      });
      this.drainUpdates();
    });
  }

  unsubscribe() {
    this.#adapter.unsubscribe();
  }

  private async drainUpdates() {
    await this.#flushUpdateEvents;
    let itemsDrained: () => void;
    this.#flushUpdateEvents = new Promise((res) => (itemsDrained = res));
    let items = [...this.#updateItems];
    this.#updateItems = [];
    for (let { operation, url } of items) {
      this.sendIndexInitiationEvent(url.href);
      let { invalidations, generation, invalidatedTypes } =
        await this.updateIndexAndCollectInvalidations([
          { url, operation: operation === 'removed' ? 'delete' : 'update' },
        ]);
      this.broadcastIncrementalInvalidationEvent(invalidations, {
        generation,
        invalidatedTypes,
      });
    }
    itemsDrained!();
  }

  private sendIndexInitiationEvent(updatedFile: string) {
    this.broadcastRealmEvent({
      eventName: 'index',
      indexType: 'incremental-index-initiation',
      updatedFile,
      realmURL: this.url,
    });
  }

  private async broadcastRealmEvent(event: RealmEventContent): Promise<void> {
    this.#adapter.broadcastRealmEvent(
      event,
      this.url,
      this.#matrixClient,
      this.#dbAdapter,
    );
  }

  // Public entry point for broadcasting a realm event that does not originate
  // from a request this Realm handled — a worker-originated event bridged in
  // through the worker manager. Unlike the private broadcastRealmEvent
  // (fire-and-forget), this awaits the adapter so the internal /_worker-request
  // endpoint doesn't leave a dangling promise and can
  // surface a resolution/dispatch throw. Delivery itself is best-effort — the
  // adapter swallows per-room send failures the same way web-tier broadcasts do
  // — so a 200 means "resolved and dispatched," not "received by every host."
  // The adapter stamps this realm's canonical url on the event, so it reaches
  // subscribed hosts exactly as a web-tier-originated event does.
  async broadcastEvent(event: RealmEventContent): Promise<void> {
    await this.#adapter.broadcastRealmEvent(
      event,
      this.url,
      this.#matrixClient,
      this.#dbAdapter,
    );
  }

  // CS-11126: no memoization. `realm_permissions` is indexed by
  // realm_url and a permissions PATCH from a peer replica must take
  // effect here without a restart, so every read-path callsite fetches
  // fresh. For requests, this is one extra indexed SELECT; for
  // world-readable reads `createRequestContext` derives the flag from
  // the same single fetch rather than calling this helper plus a
  // second fetch.
  private async createRequestContext(
    requiredPermission: RealmAction,
  ): Promise<RequestContext> {
    let fetched = await fetchRealmPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );
    let isWorldReadable = fetched['*']?.includes('read') ?? false;
    let permissions: RealmPermissions =
      requiredPermission === 'read' && isWorldReadable
        ? {
            [this.#matrixClientUserId]: ['assume-user'],
            '*': ['read'],
          }
        : {
            [this.#matrixClientUserId]: ['assume-user'],
            ...fetched,
          };

    return {
      realm: this,
      permissions,
    };
  }

  public async visibility(): Promise<RealmVisibility> {
    let permissions = await fetchRealmPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );

    let usernames = Object.keys(permissions).filter(
      (username) => !username.startsWith('@realm/'),
    );
    if (usernames.includes('*')) {
      return 'public';
    } else if (usernames.includes('users') || usernames.length > 1) {
      return 'shared';
    } else {
      return 'private';
    }
  }

  #logRequestPerformance(
    request: Request,
    startTime: number,
    prefix = 'serve time',
  ) {
    this.#perfLog.debug(
      `${prefix}: ${Date.now() - startTime}ms - ${request.method} ${
        request.url
      } ${request.headers.get('Accept') ?? ''}`,
    );
  }
}

export type Kind = 'file' | 'directory';

export function parseDeps(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    try {
      let parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch (_e) {
      return [];
    }
  }

  if (value instanceof Buffer) {
    return parseDeps(value.toString());
  }

  if (value instanceof Uint8Array) {
    return parseDeps(Buffer.from(value).toString());
  }

  return [];
}

function isGloballyPublicDependency(resourceUrl: string): boolean {
  if (resourceUrl.startsWith('data:')) {
    return true;
  }
  if (
    resourceUrl.startsWith('@cardstack/boxel-icons') ||
    resourceUrl.startsWith('@cardstack/boxel-ui') ||
    resourceUrl.startsWith('@cardstack/boxel-host/commands') ||
    // The bare-specifier spelling of the BXL platform module (e.g. a code
    // ref naming it directly). Deps the loader records for the shim take
    // the packages-fake-origin form and are admitted by the prefix check
    // below. Only the package root is card-facing — its entry re-exports
    // BXL's entire public API, and the host's VirtualNetwork shim serves
    // exactly that specifier; sub-entries exist for size-constrained
    // embeds outside the host and don't load through the shim at all.
    resourceUrl === '@cardstack/bxl' ||
    resourceUrl.startsWith(PACKAGES_FAKE_ORIGIN)
  ) {
    return true;
  }
  let parsed = maybeURL(resourceUrl);
  if (!parsed) {
    return false;
  }
  if (parsed.hostname === 'boxel-icons.boxel.ai') {
    return true;
  }
  if (
    parsed.hostname === 'packages' &&
    (parsed.pathname.startsWith('/@cardstack/boxel-ui') ||
      parsed.pathname.startsWith('/@cardstack/boxel-host/commands'))
  ) {
    return true;
  }
  return baseRealm.inRealm(parsed);
}

// A read's refusal, as the card+json GET reports it. Three of the four codes
// the read can raise name an outcome the handler already had a shape for; a
// refusal it does not recognize is an error document rather than a guess, so a
// behavior added to the read later surfaces as a 500 with its own detail
// instead of a 404 that claims the card is gone.
function cardJsonAssemblyFromFailure(
  failure: OperationFailure,
): Exclude<CardJsonAssembly, { kind: 'document' } | { kind: 'file-meta' }> {
  let { error } = failure;
  if (error.code === 'target-not-found') {
    return { kind: 'not-found' };
  }
  if (error.code === 'target-not-indexed') {
    return { kind: 'not-indexed' };
  }
  // The row's own account of what went wrong, so the response body carries the
  // underlying title, message and salvage rather than the sentence the refusal
  // renders from them.
  let row = erroredTargetRow(failure);
  if (!row) {
    return {
      kind: 'error',
      error: {
        status: error.status,
        title: error.title,
        message: error.detail,
        stack: undefined,
        lastKnownGoodHtml: null,
        cardTitle: null,
        scopedCssUrls: [],
      },
    };
  }
  // Read whole rather than member by member: a row that recorded no title is
  // reporting that it has none, and coalescing that absence away would put the
  // refusal's own default in a body the row is supposed to describe.
  return {
    kind: 'error',
    error: {
      status: row.status,
      title: row.title,
      message: row.message,
      stack: row.stack,
      lastKnownGoodHtml: row.lastKnownGoodHtml,
      cardTitle: row.cardTitle,
      scopedCssUrls: row.scopedCssUrls,
    },
  };
}

function lastModifiedHeader(
  card: LooseSingleCardDocument,
): {} | { 'last-modified': string } {
  return (
    card.data.meta.lastModified != null
      ? { 'last-modified': formatRFC7231(card.data.meta.lastModified * 1000) }
      : {}
  ) as {} | { 'last-modified': string };
}

// The document a write's own commit stored, for an answer that does not come
// out of the index — a write whose indexing is deferred, and the browser-test
// fallback for a card the index cannot yet speak for. These are the bytes the
// commit wrote, as the batch reported them, so nothing can have moved
// underneath them between the write and the answer. Undefined when the batch
// was not asked for them (`reportStoredContent`).
function storedCardDocument(
  result: BatchEntryResult,
): LooseSingleCardDocument | undefined {
  let content = result?.meta.storedContent;
  return content == null
    ? undefined
    : (JSON.parse(content) as LooseSingleCardDocument);
}

// Visibility hook for the foreign-realm-deps ETag suppression — when
// a card+json response declines to emit an ETag because it has
// dependencies in another realm, this header surfaces the reason so
// ops can measure how often the guard fires (Grafana / log
// aggregation) and prioritize wiring up cross-realm dep
// invalidation in `index-writer.calculateInvalidations`. Once that
// lands, both this header and the suppression itself can come out.
function etagSuppressedHeader(
  hasForeignDeps: boolean,
): {} | { 'X-Boxel-Etag-Suppressed': string } {
  return hasForeignDeps ? { 'X-Boxel-Etag-Suppressed': 'foreign-deps' } : {};
}

export type ErrorReporter = (error: Error) => void;

let globalWithErrorReporter = global as typeof globalThis & {
  __boxelErrorReporter: ErrorReporter;
};

export function setErrorReporter(reporter: ErrorReporter) {
  globalWithErrorReporter.__boxelErrorReporter = reporter;
}

export function reportError(error: Error) {
  if (globalWithErrorReporter.__boxelErrorReporter) {
    globalWithErrorReporter.__boxelErrorReporter(error);
  }
}

export interface CardDefinitionResource {
  id: string;
  type: 'card-definition';
  attributes: {
    cardRef: CodeRef;
  };
  relationships: {
    [fieldName: string]: {
      links: {
        related: string;
      };
      meta: {
        type: 'super' | 'contains' | 'containsMany';
        ref: CodeRef;
      };
    };
  };
}

// A change set whose every URL names a file that is there to be visited.
function asUpdates(urls: URL[]): IndexChange[] {
  return urls.map((url) => ({ url, operation: 'update' as const }));
}

function assertRealmPermissions(
  realmPermissions: any,
): asserts realmPermissions is RealmPermissions {
  if (typeof realmPermissions !== 'object') {
    throw new Error(`permissions must be an object`);
  }
  for (let [user, permissions] of Object.entries(realmPermissions)) {
    if (typeof user !== 'string') {
      throw new Error(`user ${user} must be a string`); // could be a symbol
    }
    if (!Array.isArray(permissions) && permissions !== null) {
      throw new Error(`permissions must be an array or null`);
    }
    if (permissions && permissions.length > 0) {
      for (let permission of permissions) {
        if (!['read', 'write', 'realm-owner'].includes(permission)) {
          throw new Error(`'${permission}' is not a valid permission`);
        }
      }
    }
  }
}

// Stage clocks the `_screenshot/` serving path accumulates ahead of the
// hit/miss fork; the terminal emit folds them into the request's telemetry
// record (see `screenshot-perf.ts`).
interface ScreenshotServePerf {
  requestStart: number;
  correlationId: string | null;
  generationLookupMs: number;
  ledgerLookupMs: number;
  // The encoding this request concerns: spec-derived on the DSL path (known
  // even when the capture never runs), the served row's own contentType on
  // the named path.
  contentType: CaptureContentType | null;
}
