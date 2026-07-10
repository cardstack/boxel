import { Deferred } from './deferred.ts';
import type { RealmVisibility } from './realm-visibility.ts';
import type { SearchOpts } from './search-utils.ts';
import { buildSearchErrorBody, SearchRequestError } from './search-utils.ts';
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
import type {
  CardResource,
  HtmlQuery,
  HtmlResource,
  Relationship,
} from './resource-types.ts';
import {
  clearReplacedArrayFieldMeta,
  HtmlResourceType,
} from './resource-types.ts';
import { normalizeRelationships } from './relationship-utils.ts';
import type { LocalPath } from './paths.ts';
import { RealmPaths, ensureTrailingSlash, join } from './paths.ts';
import type ms from 'ms';
import {
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
} from './constants.ts';
import {
  persistFileMeta,
  removeFileMeta,
  getCreatedTime,
  getContentMeta,
} from './file-meta.ts';
import {
  systemError,
  notFound,
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
import { v4 as uuidV4 } from 'uuid';
import { formatRFC7231 } from 'date-fns';
import {
  isCardResource,
  isModuleResource,
  executableExtensions,
  hasExecutableExtension,
  isNode,
  logger,
  fetchRealmPermissions,
  isRealmArchived,
  baseRealm,
  maybeURL,
  insertPermissions,
  maybeHandleScopedCSSRequest,
  authorizationMiddleware,
  internalKeyFor,
  unixTime,
  query,
  param,
  dbExpression,
  dbAdapterQuerier,
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
  userInitiatedPriority,
  systemInitiatedPriority,
  userIdFromUsername,
  isCardDocumentString,
  isBrowserTestEnv,
  unresolveResourceInstanceURLs,
  type IndexedFile,
  type LooseCardResource,
  type FileMetaResource,
} from './index.ts';
import type { FromScratchResult } from './tasks/indexer.ts';
import { isCodeRef, visitModuleDeps } from './code-ref.ts';
import { merge } from 'lodash-es';
import { mergeWith } from 'lodash-es';
import { cloneDeep } from 'lodash-es';
import { isEqual } from 'lodash-es';
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
import { mergeRelationships } from './merge-relationships.ts';
import { getCardDirectoryName } from './helpers/card-directory-name.ts';
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
import { fetcher } from './fetcher.ts';
import { RealmIndexQueryEngine } from './realm-index-query-engine.ts';
import { RealmIndexUpdater } from './realm-index-updater.ts';
import serialize from './file-serializer.ts';
import { validateWriteSize } from './write-size-validation.ts';
import { md5 } from 'super-fast-md5';
import { resolveFileDefCodeRef } from './file-def-code-ref.ts';

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
  // Opt-in to producing the full prerendered isolated HTML for the
  // realm's default CardsGrid index card. When undefined / null /
  // false the host's render route substitutes a small boilerplate
  // placeholder instead and skips the (expensive) isolated render.
  // The lever is primarily set by the publish handler on the
  // published realm snapshot so anonymous-visitor SSR injection has
  // real content; unpublished realms typically have nothing reading
  // the index's isolated HTML. Optional to avoid forcing every
  // RealmInfo fixture to update.
  includePrerenderedDefaultRealmIndex?: boolean | null;
};

// Marker header the host SPA attaches to outbound _federated-search /
// _search calls when it's running inside a prerender tab. The prerender
// server uses puppeteer's `evaluateOnNewDocument` to inject a window
// global (`__boxelRenderContext = true`) into every Chrome tab before
// the host loads; the host's realm-server fetch wrapper then reads that
// flag and adds this header on its own outbound search requests only —
// narrowly scoped so non-realm-server origins (icons, vite, etc.) don't
// see it on a CORS preflight. When the realm sees this on an inbound
// _search request it knows the caller is the host SPA mid-render and
// switches the search to cacheOnlyDefinitions:true, which short-circuits
// the recursive lookupDefinition → prerenderModule path in
// populateQueryFields that causes self-referential prerender deadlocks
// under parallel indexing. Kept as a bare string here so runtime-common
// stays independent of realm-server. The realm-server prerender side
// re-exports the same value from prerender-constants.ts.
export const DURING_PRERENDER_HEADER = 'x-boxel-during-prerender';
function isDuringPrerenderRequest(request: Request): boolean {
  return (request.headers.get(DURING_PRERENDER_HEADER) ?? '').length > 0;
}

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;

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
// `localPath`s (no leading slash) exempt from the archived-realm seal: the
// realm's public operational endpoints, which must keep working while a realm
// is archived. `_readiness-check` is the health probe; `_session` is the
// authentication endpoint. Matched on path rather than `Accept`/`Content-Type`
// so the exemption holds for header-less probes too. Keep in sync with
// `#publicEndpoints`.
const ARCHIVED_SEAL_EXEMPT_PATHS = new Set(['_readiness-check', '_session']);
const MODULE_ETAG_VARIANT = 'module';
const SOURCE_ETAG_VARIANT = 'source';
// Card+JSON ETag is `"<indexed_at>-<realmInfoHash>:card"` — quoted
// per RFC 9110 §8.8.3 so CDNs / browsers don't re-quote inbound
// validators and split the cache key. Two inputs feed the base:
//   - `indexed_at` on the primary card's index row, which bumps on
//     direct writes AND dependency-triggered re-writes (so the deps
//     graph carries cascading invalidations forward through it);
//   - md5 of the cached `RealmInfo`, since `attachRealmInfo()`
//     injects `meta.realmInfo` (name / icon / `lastPublishedAt`)
//     into the assembled response at request time and that field
//     can change without any card being re-indexed.
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
  // md5 of the materialized body, computed once on cache populate. Used
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

// ETag base prefers a content fingerprint (md5 of the file body) over
// `lastModified` because the unix-second timestamp collides for two
// writes that land in the same second — and `cachedFetch` (loader →
// cached-fetch) will then serve a stale 304-cached body. We compute the
// content hash on the cache-miss path of the source endpoint, where the
// content is already being materialized into memory, and stash it on the
// cache entry so subsequent serves reuse it. Adapters that don't yet
// surface a content fingerprint fall back to `lastModified` and keep the
// pre-existing behavior.
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

// Card+JSON ETag = `"<indexed_at>-<realmInfoHash>:card"`. The value
// is wrapped in double quotes to satisfy RFC 9110 §8.8.3 — CDNs and
// browsers don't re-quote inbound validators and an unquoted token
// would fail strict-validator parsing in some intermediaries.
// `indexedAt` captures direct + dep-cascaded writes; the
// `realmInfoHash` captures `attachRealmInfo()`'s request-time
// injection of `meta.realmInfo` (which can flip without re-indexing
// any card). A null `indexedAt` suppresses ETag emission entirely.
function buildCardJsonEtag(
  indexedAt: number | null | undefined,
  realmInfoHash: string | undefined,
): string | undefined {
  if (indexedAt == null) {
    return undefined;
  }
  let base = realmInfoHash ? `${indexedAt}-${realmInfoHash}` : `${indexedAt}`;
  return `"${base}:${CARD_JSON_ETAG_VARIANT}"`;
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
function buildEntryHtmlEtag(
  doc: EntrySingleDocument,
  realmInfoHash: string | undefined,
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

function computeContentHash(content: string | Uint8Array): string {
  try {
    if (content instanceof Uint8Array) {
      return md5(content);
    }
    return md5(new TextEncoder().encode(content));
  } catch {
    try {
      return md5(String(content));
    } catch {
      throw new Error('Failed to compute content hash');
    }
  }
}

// Cheap helper for the source endpoint: returns md5 of the body when the
// ref has already been materialized to a string or Uint8Array. Returns
// undefined for stream refs (the caller falls back to lastModified).
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

export interface FileWriteResult extends AdapterWriteResult {
  path: string;
  lastModified: number;
  created: number | null;
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
  // only the final indexing await. The first concrete caller is the per-
  // file `+source` POST handler, which writes a single file at a time, so
  // the intermediate-flush path is not exercised in practice.
  waitForIndex?: boolean | null;
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
}

interface UpdateItem {
  operation: 'add' | 'update' | 'removed';
  url: URL;
}

export interface MatrixConfig {
  url: URL;
  username: string;
}

export type RequestContext = { realm: Realm; permissions: RealmPermissions };

export class Realm {
  #startedUp = new Deferred<void>();
  #matrixClient: MatrixClient;
  #matrixClientUserId: string;
  #realmServerURL: string;
  #realmIndexUpdater: RealmIndexUpdater;
  #realmIndexQueryEngine: RealmIndexQueryEngine;
  #adapter: RealmAdapter;
  #router: Router;
  #log = logger('realm');
  #perfLog = logger('perf');
  #updateItems: UpdateItem[] = [];
  #flushUpdateEvents: Promise<void> | undefined;
  #recentWrites: Map<string, number> = new Map();
  #realmSecretSeed: string;
  #disableModuleCaching = false;
  #fullIndexOnStartup = false;
  #skipBootIndex = false;
  #fromScratchIndexPriority = systemInitiatedPriority;
  #definitionLookup: DefinitionLookup;
  #copiedFromRealm: URL | undefined;
  #sourceCache = new AliasCache<SourceCacheEntry>();
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
  #cachedRealmInfo: RealmInfo | null = null;
  // md5 of the JSON-stringified `#cachedRealmInfo`. Folded into the
  // card+json ETag so any path that nulls `#cachedRealmInfo` (e.g.
  // invalidateCachedRealmInfo on publish/unpublish) invalidates cached
  // card responses, even though the index row's `indexed_at` doesn't
  // bump on a config change. Recomputed lazily alongside the cached
  // realm info.
  #cachedRealmInfoHash: string | null = null;
  // Cached host routing map, derived from the indexed RealmConfig card.
  // `getHostRoutingMap()` is called on every host-mode index request
  // (serve-index), so re-querying the index each time is wasteful — the map
  // only changes when the realm is (re)indexed. Dropped by
  // `clearRealmIndexCaches()` alongside `#cachedRealmInfo`, which fires on
  // every index swap (full/incremental/publish) both locally and on peer
  // replicas via the realm_index_updated broadcast. `null` means "not yet
  // computed"; an empty array is a valid cached result (no routing rules).
  #cachedHostRoutingMap: { path: string; id: string }[] | null = null;

  // This loader is not meant to be used operationally, rather it serves as a
  // template that we clone for each indexing operation
  readonly __fetchForTesting: typeof globalThis.fetch;
  readonly paths: RealmPaths;

  get url(): string {
    return this.paths.url;
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
      transpileCoordinator,
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
      // CS-11030: when set, the realm coalesces concurrent cross-process
      // transpiles through an advisory-lock + NOTIFY winner/loser flow
      // and persists the resulting bytes to `module_transpile_cache` so
      // peers re-read instead of re-running babel. Optional — sqlite /
      // in-memory deployments leave this undefined and the uncoordinated
      // CS-11029 in-process dedup is the only sharing layer.
      transpileCoordinator?: PopulateCoordinator;
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
    this.#disableModuleCaching = Boolean(opts?.disableModuleCaching);
    this.#copiedFromRealm = opts?.copiedFromRealm;
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

    Object.values(SupportedMimeType).forEach((mimeType) => {
      if (mimeType !== SupportedMimeType.CardSource) {
        this.#router.head('/.*', mimeType as SupportedMimeType, async () => {
          let requestContext = await this.createRequestContext('read');
          return createResponse({ init: { status: 200 }, requestContext });
        });
      }
    });
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
    _request: Request,
    requestContext: RequestContext,
  ) {
    await this.#startedUp.promise;
    // #startedUp is a one-time gate that resolves after the first start()'s
    // from-scratch index. On a republish the realm is already mounted with a
    // resolved #startedUp, so awaiting it alone would report ready before the
    // reindex of the swapped files completes. Also await any in-flight full or
    // incremental index so a publish poll only succeeds once the just-published
    // content is indexed and viewable.
    let inflight = this.indexing();
    if (inflight) {
      await inflight;
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
        `indexing:${this.url}`,
      );
    } else {
      await cancelRunningJobsInConcurrencyGroup(
        this.#dbAdapter,
        `indexing:${this.url}`,
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
    urls: URL[],
    opts?: {
      delete?: true;
      clientRequestId?: string | null;
    },
  ): Promise<{ invalidations: string[]; generation?: number }> {
    if (urls.length === 0) {
      return { invalidations: [] };
    }

    let invalidations = new Set<string>();
    let generation: number | undefined;
    await this.#realmIndexUpdater.update(urls, {
      ...(opts?.delete ? { delete: true } : {}),
      clientRequestId: opts?.clientRequestId ?? null,
      onInvalidation: async (invalidatedURLs: URL[], meta) => {
        // Drop the searchCards in-flight map: the worker's batch.done()
        // swap landed in this realm's boxel_index, so any pending
        // pre-update promises must not be coalesced into by post-update
        // callers. CS-11119 also broadcasts the same wipe to peer
        // replicas via NOTIFY realm_index_updated so their #inFlightSearch
        // maps don't coalesce post-update callers into pre-update promises.
        await this.clearRealmIndexCachesAndBroadcast();
        await this.handleExecutableInvalidations(invalidatedURLs);
        for (let invalidatedURL of invalidatedURLs) {
          invalidations.add(invalidatedURL.href);
        }
        generation = meta.generation ?? generation;
      },
    });

    return { invalidations: [...invalidations], generation };
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
    urls: URL[],
    opts: {
      delete?: true;
      clientRequestId?: string | null;
      onSettled?: (
        invalidations: string[],
        meta: { generation?: number },
      ) => Promise<void> | void;
    },
  ): Promise<{ settled: Promise<void> }> {
    if (urls.length === 0) {
      if (opts.onSettled) {
        await opts.onSettled([], {});
      }
      return { settled: Promise.resolve() };
    }

    let invalidations = new Set<string>();
    let generation: number | undefined;
    let { settled } = await this.#realmIndexUpdater.enqueueUpdate(urls, {
      ...(opts?.delete ? { delete: true } : {}),
      clientRequestId: opts?.clientRequestId ?? null,
      onInvalidation: async (invalidatedURLs: URL[], meta) => {
        await this.clearRealmIndexCachesAndBroadcast();
        await this.handleExecutableInvalidations(invalidatedURLs);
        for (let invalidatedURL of invalidatedURLs) {
          invalidations.add(invalidatedURL.href);
        }
        generation = meta.generation ?? generation;
      },
      onSettled: async () => {
        if (opts.onSettled) {
          await opts.onSettled([...invalidations], { generation });
        }
      },
    });

    return { settled };
  }

  private broadcastIncrementalInvalidationEvent(
    invalidations: string[],
    opts?: { clientRequestId?: string | null; generation?: number },
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

    let { invalidations, generation } =
      await this.updateIndexAndCollectInvalidations(urls);
    this.broadcastIncrementalInvalidationEvent(invalidations, { generation });

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

  async fullIndex(priority?: number, opts?: { clearLastModified?: boolean }) {
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
      { clearLastModified: opts?.clearLastModified },
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
  // serialize concurrent same-URL writers across replicas via the per-realm
  // advisory lock. The lock spans the FS write + index update so two
  // replicas can't both commit on top of the same pre-state.
  //
  // HTTP route handlers in this file that need their READ to be inside the
  // same critical section as the write (the `/_atomic` precheck and
  // `patchCardInstance`'s indexEntry read) take the lock themselves at the
  // handler boundary and invoke `_batchWriteUnlocked` directly — re-entering
  // through the public methods would deadlock (a second
  // `pg_advisory_xact_lock` on the same key would block on its own pinned
  // pool connection).
  async write(
    path: LocalPath,
    contents: string | Uint8Array,
    options?: WriteOptions,
  ): Promise<FileWriteResult> {
    let results = await this.#dbAdapter.withWriteLock(this.url, () =>
      this._batchWriteUnlocked(new Map([[path, contents]]), options),
    );
    return results[0];
  }

  async writeMany(
    files: Map<LocalPath, string | Uint8Array>,
    options?: WriteOptions,
  ): Promise<FileWriteResult[]> {
    return this.#dbAdapter.withWriteLock(this.url, () =>
      this._batchWriteUnlocked(files, options),
    );
  }

  private async _batchWriteUnlocked(
    files: Map<LocalPath, string | Uint8Array>,
    options?: WriteOptions,
  ): Promise<FileWriteResult[]> {
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
    if (options?.waitForIndex !== false) {
      await this.incrementalIndexing();
    }
    let urls: URL[] = [];
    // Collect write results for all files we wrote
    let results: { path: LocalPath; lastModified: number }[] = [];
    let fileMetaRows: {
      path: LocalPath;
      contentHash?: string;
      contentSize?: number;
    }[] = [];
    let lastWriteType: 'module' | 'instance' | undefined;
    let addedFiles: LocalPath[] = [];
    let updatedFiles: LocalPath[] = [];
    let invalidations: Set<string> = new Set();
    let indexGeneration: number | undefined;
    let clientRequestId: string | null = options?.clientRequestId ?? null;
    let performIndex = async () => {
      let { invalidations: workingInvalidations, generation } =
        await this.updateIndexAndCollectInvalidations(urls, {
          clientRequestId,
        });
      invalidations = new Set([...invalidations, ...workingInvalidations]);
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
        await performIndex();
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
      this.assertWriteSize(content, sizeType);
      let isNewFile: boolean;
      if (typeof content === 'string') {
        let existingFile = await readFileAsText(path, (p) =>
          this.#adapter.openFile(p),
        );
        if (existingFile?.content === content) {
          results.push({ path, lastModified: existingFile.lastModified });
          fileMetaRows.push({ path });
          continue;
        }
        isNewFile = !existingFile;
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
      results.push({ path, lastModified });
      fileMetaRows.push({ path, contentHash, contentSize });
      urls.push(url);
      lastWriteType = currentWriteType ?? lastWriteType;
    }

    if (addedFiles.length > 0 || updatedFiles.length > 0) {
      if ([...addedFiles, ...updatedFiles].some((f) => f === 'realm.json')) {
        this.invalidateCachedRealmInfo();
      }
      this.broadcastRealmEvent({
        eventName: 'update',
        ...(addedFiles.length ? { added: addedFiles } : {}),
        ...(updatedFiles.length ? { updated: updatedFiles } : {}),
        realmURL: this.url,
      } as UpdateRealmEventContent);
    }

    // persist file meta (created_at) to DB independent of index and retrieve created
    let createdMap = await this.persistFileMeta(fileMetaRows);
    let waitForIndex = options?.waitForIndex !== false;
    if (urls.length > 0) {
      if (waitForIndex) {
        await performIndex();
        this.broadcastIncrementalInvalidationEvent([...invalidations], {
          clientRequestId,
          generation: indexGeneration,
        });
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
        let { settled } = await this.enqueueIndexUpdateAndCollectInvalidations(
          urls,
          {
            clientRequestId,
            // Route the post-worker broadcast through onSettled so it runs
            // INSIDE the indexing deferred lifecycle. Without this, the
            // broadcast would fire from an outer .then() after the deferred
            // is already removed — meaning realm.incrementalIndexing()
            // resolves before the broadcast, and an afterEach drain that
            // awaits the drain still races with the broadcast against
            // test teardown (mock-matrix already destroyed → broadcast
            // throws on serverState).
            onSettled: (deferredInvalidations, meta) => {
              this.broadcastIncrementalInvalidationEvent(
                [...new Set([...priorInvalidations, ...deferredInvalidations])],
                {
                  clientRequestId,
                  generation: meta.generation ?? indexGeneration,
                },
              );
            },
          },
        );
        settled.catch((err: unknown) => {
          // Covers worker job rejection AND post-worker realm-side work
          // (onInvalidation / handleExecutableInvalidations / broadcast).
          this.#log.error(
            `Deferred indexing chain failed for ${this.url} (urls: ${urls
              .map((u) => u.href)
              .join(', ')}): ${stringifyErrorForLog(err)}`,
          );
        });
      }
    } else {
      // No urls actually written (e.g., content unchanged). Preserve the
      // pre-existing always-broadcast behavior.
      this.broadcastIncrementalInvalidationEvent([...invalidations], {
        clientRequestId,
        generation: indexGeneration,
      });
    }
    return results.map(({ path, lastModified }) => ({
      path,
      lastModified,
      created: createdMap.get(path)?.createdAt ?? null,
    }));
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

    // Take the per-realm advisory lock from the precheck through the
    // write. Without this, two replicas could both pass
    // `checkBeforeAtomicWrite` for the same `add` operation (file does
    // not exist), then both proceed to write — last writer wins on disk
    // but indexer state is incoherent. Inside the lock we invoke
    // `_batchWriteUnlocked` directly to avoid re-acquiring the same
    // advisory lock through `writeMany` (which would deadlock on a
    // different pinned pool connection).
    return await this.#dbAdapter.withWriteLock(this.url, async () => {
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
          this.assertWriteSize(content, 'file');
          files.set(localPath, content);
        } else if (isCardResource(resource)) {
          let doc = {
            data: resource,
          };
          let jsonString = JSON.stringify(doc, null, 2);
          this.assertWriteSize(jsonString, 'card');
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
    });
  }

  // we track our own writes so that we can eliminate echoes in the file watcher
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
    options?: { waitForIndex?: boolean },
  ): Promise<void> {
    await this.#dbAdapter.withWriteLock(this.url, () =>
      this._deleteUnlocked(path, options),
    );
  }

  private async _deleteUnlocked(
    path: LocalPath,
    options?: { waitForIndex?: boolean },
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
      let { invalidations, generation } =
        await this.updateIndexAndCollectInvalidations([url], {
          delete: true,
        });
      this.broadcastIncrementalInvalidationEvent(invalidations, { generation });
    } else {
      // Mirrors the write() waitForIndex:false path: await the durable
      // enqueue so DB-side failures still bubble out, but fire-and-forget
      // the worker settle. The post-worker broadcast runs inside the
      // deferred lifecycle via onSettled so realm.incrementalIndexing()
      // doesn't resolve before the broadcast.
      let enqueueStart = Date.now();
      let { settled } = await this.enqueueIndexUpdateAndCollectInvalidations(
        [url],
        {
          delete: true,
          onSettled: (deferredInvalidations, meta) => {
            this.broadcastIncrementalInvalidationEvent(deferredInvalidations, {
              generation: meta.generation,
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
    await this.#dbAdapter.withWriteLock(this.url, () =>
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
    let { invalidations, generation } =
      await this.updateIndexAndCollectInvalidations(urls, {
        delete: true,
      });
    this.broadcastIncrementalInvalidationEvent(invalidations, { generation });
  }

  get realmIndexUpdater() {
    return this.#realmIndexUpdater;
  }

  get realmIndexQueryEngine() {
    return this.#realmIndexQueryEngine;
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
            '7d',
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
        await this.checkPermission(request, requestContext, requiredPermission);
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
      return {
        kind: 'non-module',
        response: await this.serveLocalFile(request, fileRef, requestContext, {
          defaultHeaders: {
            'content-type': inferContentType(fileRef.path),
          },
        }),
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

    return this.#transpileModuleDeduped(localPath, fileRef, etag);
  }

  // Dedups the materialize + transpile pipeline across concurrent
  // same-path callers (CS-11029). The first caller installs a pending
  // promise keyed by localPath; any caller that arrives while it's
  // in-flight returns the same promise instead of running babel a
  // second time. Identity-checked cleanup on settle mirrors
  // CachingDefinitionLookup.#inFlight — a newer pending entry installed
  // after invalidateCache drops the slot is preserved when the older
  // promise eventually settles.
  async #transpileModuleDeduped(
    localPath: LocalPath,
    fileRef: FileRef,
    etag: string | undefined,
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
    let core = this.#transpileWithLayers(fileRef, etag);
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
  ): Promise<ModuleTranspileResult> {
    let canonicalPath = this.paths.fileURL(fileRef.path).href;
    let coordinator = this.#transpileCoordinator;

    // L2 read first — cheap query (UNLOGGED, indexed PK), saves babel.
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
      let result = await this.#materializeAndTranspile(fileRef, etag);
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
        let result = await this.#materializeAndTranspile(fileRef, etag);
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
    let result = await this.#materializeAndTranspile(fileRef, etag);
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
  ): Promise<ModuleTranspileResult> {
    let canonicalPath = this.paths.fileURL(fileRef.path).href;
    let fileWithContent = await this.materializeFileRef(fileRef);
    let source = await fileContentToText(fileWithContent);
    let transpiled: string;
    try {
      // Force an absolute path so babel's internal path.resolve doesn't depend
      // on process.cwd(), which differs between node and browser shims and was
      // observed to drop the leading slash on vite builds — producing a
      // moduleName of "dir/person.gts" instead of "/dir/person.gts" in
      // compiled templates.
      let debugFilename = fileWithContent.path.startsWith('/')
        ? fileWithContent.path
        : `/${fileWithContent.path}`;
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

  private async serveLocalFile(
    request: Request,
    ref: FileRef,
    requestContext: RequestContext,
    options?: {
      defaultHeaders?: Record<string, string>;
      etagVariant?: string;
      // Optional content-derived fingerprint (e.g. md5 of body bytes).
      // Takes precedence over `ref.lastModified` for the ETag — see
      // `buildEtag`. Callers that have the materialized body already
      // (the source endpoint cache-miss path) compute this for free.
      etagBase?: string;
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
      options?.etagBase ?? ref.lastModified,
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
    let createdFromDb = await this.getCreatedTime(ref.path);
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

  private async checkPermission(
    request: Request,
    requestContext: RequestContext,
    requiredPermission: 'read' | 'write' | 'realm-owner',
  ) {
    let realmPermissions = requestContext.permissions;
    if (
      requiredPermission !== 'realm-owner' &&
      (lookupRouteTable(this.#publicEndpoints, this.paths, request) ||
        request.method === 'HEAD' ||
        // If the realm is public readable or writable, do not require a JWT
        (requiredPermission === 'read' &&
          realmPermissions['*']?.includes('read')) ||
        (requiredPermission === 'write' &&
          realmPermissions['*']?.includes('write')))
    ) {
      return;
    }

    let authorizationString = request.headers.get('Authorization');
    if (!authorizationString) {
      this.#log.warn(
        `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}) missing auth header`,
      );
      throw new AuthenticationError(
        AuthenticationErrorMessages.MissingAuthHeader,
      );
    }
    let tokenString = authorizationString.replace('Bearer ', ''); // Parse the JWT

    let token: TokenClaims;

    try {
      token = this.#adapter.verifyJWT(tokenString, this.#realmSecretSeed);

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
          this.#log.warn(
            `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), delegated session for user ${user} is scoped to realm ${token.realm}, not ${this.url}`,
          );
          throw new AuthenticationError(
            AuthenticationErrorMessages.TokenInvalid,
          );
        }
        if (requiredPermission !== 'read') {
          this.#log.warn(
            `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), delegated session for user ${user} attempted ${requiredPermission}; delegated sessions are read-only`,
          );
          throw new AuthorizationError('Delegated sessions are read-only');
        }
        if (!(await realmPermissionChecker.can(user, 'read'))) {
          this.#log.warn(
            `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), delegated session for user ${user} but user lacks read permission`,
          );
          throw new AuthenticationError(
            AuthenticationErrorMessages.PermissionMismatch,
          );
        }
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
        return;
      }

      let userPermissions = await realmPermissionChecker.for(user);
      if (
        !didAssumeUser &&
        JSON.stringify(token.permissions?.sort()) !==
          JSON.stringify(userPermissions.sort())
      ) {
        this.#log.warn(
          `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), for user ${user} token permissions do not match realm permissions for user. token permissions: ${JSON.stringify(token.permissions?.sort())}, user's realm permissions: ${JSON.stringify(userPermissions.sort())}`,
        );
        throw new AuthenticationError(
          AuthenticationErrorMessages.PermissionMismatch,
        );
      }

      if (!(await realmPermissionChecker.can(user, requiredPermission))) {
        this.#log.warn(
          `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), for user ${user} permissions insufficient. requires ${requiredPermission}, but user permissions: ${JSON.stringify(userPermissions.sort())}`,
        );
        throw new AuthorizationError(
          'Insufficient permissions to perform this action',
        );
      }
    } catch (e: any) {
      if (e?.constructor?.name === 'TokenExpiredError') {
        this.#log.warn(
          `JWT verification failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}) with token string ${tokenString}. ${e.message}, expired at ${e.expiredAt}`,
        );
        throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
      }
      if (e?.constructor?.name === 'JsonWebTokenError') {
        this.#log.warn(
          `JWT verification failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}) with token string ${tokenString}. ${e.message}`,
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
    // Source-content-type callers, by definition, don't depend on indexed
    // state — if they did they would use application/vnd.card+json. Return
    // as soon as the source bytes are durable; indexing happens async and
    // surfaces errors via error_doc as before. Subscribers to indexing
    // events still see the broadcast once the worker settles.
    let { lastModified, created } = await this.write(
      this.paths.local(new URL(request.url)),
      await request.text(),
      {
        clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
        serializeFile: false,
        waitForIndex: false,
      },
    );
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

  private async upsertBinaryFile(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Binary files have no indexable card representation, so awaiting the
    // index update would be even more wasteful than for card source. Return
    // as soon as the bytes are durable.
    let bytes = new Uint8Array(await request.arrayBuffer());
    let { lastModified, created } = await this.write(
      this.paths.local(new URL(request.url)),
      bytes,
      {
        clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
        serializeFile: false,
        waitForIndex: false,
      },
    );
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

  private assertWriteSize(content: string | Uint8Array, type: 'card' | 'file') {
    let limit =
      type === 'card' ? this.#cardSizeLimitBytes : this.#fileSizeLimitBytes;
    try {
      validateWriteSize(content, limit, type);
    } catch (error: any) {
      throw new CardError(error?.message ?? 'Payload too large', {
        status: 413,
        title: 'Payload Too Large',
      });
    }
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
          Location: `${new URL(this.url).pathname}${handle.path}`,
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

      let createdAt = await this.getCreatedTime(handle.path);
      let defaultHeaders: Record<string, string> = {
        'content-type': inferContentType(handle.path),
        ...(createdAt != null
          ? { 'x-created': formatRFC7231(createdAt * 1000) }
          : {}),
        [CACHE_HEADER]: CACHE_MISS_VALUE,
      };
      if (bypassCache) {
        return await this.serveLocalFile(request, handle, requestContext, {
          defaultHeaders,
          etagVariant: SOURCE_ETAG_VARIANT,
        });
      } else {
        let cachedRef = await this.materializeFileRef(handle);
        // Test-only gate: park here (bytes read, cache not yet written) so the
        // source-cache race test can fire invalidateCache before the set.
        if (this.#testOnlySourceCacheDelay) {
          await this.#testOnlySourceCacheDelay();
        }
        // Compute the content fingerprint while we have the body in
        // memory — `cachedRef.content` is already a string/Uint8Array
        // post-materialization, so this is a single md5 with no extra I/O.
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
    await this.delete(handle.path, { waitForIndex: false });
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

  private async fileMetaDocument(
    requestContext: RequestContext,
    localPath: LocalPath,
    contentType: SupportedMimeType = SupportedMimeType.CardJson,
  ): Promise<Response | undefined> {
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
    let realmInfo = await this.parseRealmInfo();
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
        },
        links: { self: fileURL },
      },
    };
    this.#serveInstanceIdsAsRRI(doc);
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

  private async fileMetaDocumentFromIndex(
    requestContext: RequestContext,
    localPath: LocalPath,
    fileEntry: IndexedFile,
  ): Promise<Response> {
    let fileURL = this.paths.fileURL(localPath).href;
    let name = localPath.split('/').pop() ?? localPath;
    let inferredContentType = inferContentType(name);
    let createdAt = fileEntry.resourceCreatedAt ?? fileEntry.lastModified;
    let realmInfo = await this.parseRealmInfo();
    let searchDoc = fileEntry.searchDoc ?? {};
    let searchHash =
      typeof searchDoc.contentHash === 'string'
        ? searchDoc.contentHash
        : undefined;
    let searchSize =
      typeof searchDoc.contentSize === 'number'
        ? searchDoc.contentSize
        : undefined;
    // Only hit the DB when the indexed searchDoc is missing a value.
    let persistedMeta =
      (searchHash === undefined || searchSize === undefined) && this.#dbAdapter
        ? await getContentMeta(this.#dbAdapter, this.url, localPath)
        : { contentHash: undefined, contentSize: undefined };
    let contentHash = searchHash ?? persistedMeta.contentHash;
    let contentSize = searchSize ?? persistedMeta.contentSize;
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
      contentHash: resourceAttributes.contentHash ?? contentHash,
      contentSize: resourceAttributes.contentSize ?? contentSize,
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
          // Per-field subclass overrides for nested polymorphic fields (e.g.
          // `frontmatter` → SkillFrontmatterField). Without this the field
          // rehydrates as its declared base type when the document is read.
          ...(fileEntry.resource?.meta?.fields
            ? { fields: fileEntry.resource.meta.fields }
            : {}),
          ...(fileEntry.resource?.meta?.queryFieldDefs
            ? { queryFieldDefs: fileEntry.resource.meta.queryFieldDefs }
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

  private async createCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Drain any in-flight incremental indexing before serializing the new
    // card. fileSerialization runs lookupDefinition on the card's
    // adoptsFrom module, and with CS-11003's deferred +source POST a
    // module that was just uploaded may not be indexed yet —
    // serialization would then throw FilterRefersToNonexistentTypeError
    // and the +json POST would fail. Draining here makes the JSON-API
    // path tolerant of an immediately-preceding +source POST without
    // disturbing the +json POST's own synchronous-indexing contract.
    let pending = this.incrementalIndexing();
    if (pending) {
      await pending;
    }
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
    let files = new Map<LocalPath, string>();
    let included = (maybeIncluded ?? []) as CardResource[];
    let resources = [primaryResource, ...included];
    let primaryResourceURL: URL | undefined;
    for (let [i, resource] of resources.entries()) {
      if (
        (i > 0 && typeof resource.lid !== 'string') ||
        (resource.meta.realmURL &&
          ensureTrailingSlash(resource.meta.realmURL) !== this.url)
      ) {
        continue;
      }
      let name = getCardDirectoryName(resource.meta?.adoptsFrom, this.paths);

      let fileURL = this.paths.fileURL(
        `/${join(new URL(request.url).pathname, name, (resource.lid ?? uuidV4()) + '.json')}`,
      );
      if (i === 0) {
        primaryResourceURL = fileURL;
      }

      promoteLocalIdsToRemoteIds({
        resource,
        included,
        realmURL: new URL(this.url),
      });
      let fileSerialization: LooseSingleCardDocument | undefined;
      try {
        fileSerialization = await this.fileSerialization(
          { data: merge(resource, { meta: { realmURL: request.url } }) },
          fileURL,
        );
      } catch (err: any) {
        if (err.message.startsWith('field validation error')) {
          return badRequest({
            message: err.message,
            requestContext,
            lid: resource.lid,
          });
        } else {
          return systemError({
            requestContext,
            message: err.message,
            additionalError: err,
            lid: resource.lid,
          });
        }
      }
      let localPath = this.paths.local(fileURL);
      files.set(localPath, JSON.stringify(fileSerialization, null, 2));
    }
    if (!primaryResourceURL) {
      return systemError({
        requestContext,
        message: `unable to determine URL of the primary resource from request payload`,
        lid: primaryResource.lid,
      });
    }
    let [{ lastModified, created }] = await this.writeMany(files, {
      clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
    });

    let newURL = primaryResourceURL.href.replace(/\.json$/, '');
    let entry = await this.#realmIndexQueryEngine.cardDocument(
      new URL(newURL),
      {
        loadLinks: true,
        skipQueryBackedExpansion: isDuringPrerenderRequest(request),
      },
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
    let doc: SingleCardDocument = merge({}, entry.doc, {
      data: {
        links: { self: newURL },
        meta: { lastModified },
      },
    });
    this.#serveInstanceIdsAsRRI(doc);
    return createResponse({
      body: JSON.stringify(doc, null, 2),
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

  private async patchCardInstance(
    request: Request,
    requestContext: RequestContext,
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

    // CS-11125: serialize concurrent PATCHes against the same realm so the
    // indexEntry read, merge, and write are all inside one critical
    // section. Without the lock, two replicas could both read the same
    // `original` from boxel_index, compute independent merges, and the
    // second writer's merge would silently lose the first's changes.
    // writeMany below uses the default `waitForIndex: true`, so once the
    // lock releases the index reflects the just-committed state and the
    // next waiter's `indexEntry` read sees it.
    //
    // Inside the lock we invoke `_batchWriteUnlocked` rather than the
    // public `writeMany` — re-entering the lock through the public method
    // would block on a different pinned pool connection.
    return await this.#dbAdapter.withWriteLock(this.url, async () => {
      let primarySerialization: LooseSingleCardDocument | undefined;
      let indexEntry = await this.#realmIndexQueryEngine.instance(url, {
        includeErrors: true,
      });
      if (!indexEntry) {
        return notFound(request, requestContext);
      }
      let original = cloneDeep(
        indexEntry.instance ?? {
          type: 'card',
          meta: { adoptsFrom: patch.meta.adoptsFrom },
        },
      ) as CardResource;
      original.meta ??= { adoptsFrom: patch.meta.adoptsFrom };
      original.meta.adoptsFrom =
        original.meta.adoptsFrom ?? patch.meta.adoptsFrom;
      delete original.meta.lastModified;
      let originalClone = cloneDeep(original);

      if (
        originalClone.meta?.adoptsFrom &&
        internalKeyFor(patch.meta.adoptsFrom, url, this.#virtualNetwork) !==
          internalKeyFor(
            originalClone.meta.adoptsFrom,
            url,
            this.#virtualNetwork,
          )
      ) {
        return badRequest({
          message: `Cannot change card instance type to ${JSON.stringify(
            patch.meta.adoptsFrom,
          )}`,
          requestContext,
          id: instanceURL,
        });
      }
      let included = (maybeIncluded ?? []) as CardResource[];

      delete (patch as any).type;
      delete (patch as any).meta.realmInfo;
      delete (patch as any).meta.realmURL;

      promoteLocalIdsToRemoteIds({
        resource: patch,
        included,
        realmURL: new URL(this.url),
      });

      // When a patch fully replaces an array attribute, its per-index field
      // metadata (e.g. the polymorphic type recorded at `meta.fields['items.1']`,
      // or the array-valued `meta.fields['items']` for a composite containsMany)
      // is stale. `mergeWith` overwrites arrays in attributes but deep-merges the
      // `meta.fields` object, so without clearing these first the removed
      // element's metadata survives and can be re-applied to a new entry when the
      // array grows again. Drop the matching entries from the original before the
      // merge so the patch's own metadata (if any) wins cleanly.
      clearReplacedArrayFieldMeta(originalClone.meta, patch.attributes);

      let primaryResource = mergeWith(
        originalClone,
        patch,
        (_objectValue: any, sourceValue: any) => {
          // a patched array should overwrite the original array instead of merging
          // into an original array, otherwise we won't be able to remove items in
          // the original array
          return Array.isArray(sourceValue) ? sourceValue : undefined;
        },
      );

      if (primaryResource.relationships || patch.relationships) {
        let merged = mergeRelationships(
          primaryResource.relationships,
          patch.relationships,
        );

        if (merged && Object.keys(merged).length !== 0) {
          primaryResource.relationships = merged;
        }
      }

      // If the patch makes no semantic changes and doesn't include side-loaded
      // resources, short-circuit to avoid touching the file (and changing mtime).
      if (included.length === 0 && isEqual(primaryResource, original)) {
        let entry = await this.#realmIndexQueryEngine.cardDocument(
          new URL(instanceURL),
          {
            loadLinks: true,
            skipQueryBackedExpansion: isDuringPrerenderRequest(request),
          },
        );
        if (entry && entry.type !== 'error') {
          let existingDoc = merge({}, entry.doc, {
            data: {
              links: { self: instanceURL },
              meta: { lastModified: entry.doc.data.meta.lastModified },
            },
          });
          let createdAt = await this.getCreatedTime(
            this.paths.local(url) + '.json',
          );
          // entry.doc came from cardDocument(), which already called
          // attachRealmInfo() and (re)populated the realm-info cache —
          // so the cached hash is current as of this response.
          await this.getRealmInfo();
          let foreignDeps = this.hasForeignRealmDeps(entry.deps);
          let etag = foreignDeps
            ? undefined
            : buildCardJsonEtag(entry.indexedAt, this.getCachedRealmInfoHash());
          this.#serveInstanceIdsAsRRI(existingDoc);
          return createResponse({
            body: JSON.stringify(existingDoc, null, 2),
            init: {
              headers: {
                'content-type': SupportedMimeType.CardJson,
                'cache-control': this.cardJsonCacheControl(requestContext),
                ...(etag ? { etag } : {}),
                ...etagSuppressedHeader(foreignDeps),
                ...lastModifiedHeader(existingDoc),
                ...(createdAt != null
                  ? { 'x-created': formatRFC7231(createdAt * 1000) }
                  : {}),
              },
            },
            requestContext,
          });
        }
      }

      delete (primaryResource as any).id; // don't write the ID to the file
      let files = new Map<LocalPath, string>();
      let resources = [primaryResource, ...included];
      for (let [i, resource] of resources.entries()) {
        if (
          (i > 0 && typeof resource.lid !== 'string') ||
          (resource.meta.realmURL && resource.meta.realmURL !== this.url)
        ) {
          continue;
        }
        let name = getCardDirectoryName(resource.meta?.adoptsFrom, this.paths);
        let fileURL =
          i === 0
            ? new URL(`${url}.json`)
            : this.paths.fileURL(
                `/${join(new URL(this.url).pathname, name, (resource.lid ?? uuidV4()) + '.json')}`,
              );
        // we already did this one
        if (i !== 0) {
          promoteLocalIdsToRemoteIds({
            resource,
            included,
            realmURL: new URL(this.url),
          });
          visitModuleDeps(resource, (moduleURL, setModuleURL) => {
            setModuleURL(
              this.#virtualNetwork.resolveRRI(moduleURL, rri(instanceURL)),
            );
          });
        }
        let fileSerialization: LooseSingleCardDocument | undefined;
        try {
          fileSerialization = await this.fileSerialization(
            {
              data: merge(resource, { meta: { realmURL: this.url } }),
            },
            fileURL,
          );
        } catch (err: any) {
          if (err.message.startsWith('field validation error')) {
            return badRequest({
              message: err.message,
              requestContext,
              id: instanceURL,
            });
          } else {
            return systemError({
              requestContext,
              message: err.message,
              additionalError: err,
              id: instanceURL,
            });
          }
        }
        let path = this.paths.local(fileURL);
        files.set(path, JSON.stringify(fileSerialization, null, 2));
        if (i === 0) {
          primarySerialization = fileSerialization;
        }
      }
      // Use the unlocked inner write so we don't re-enter
      // withWriteLock (which would block on a different pinned pool
      // connection).
      let [{ lastModified, created }] = await this._batchWriteUnlocked(files, {
        clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
      });
      let entry = await this.#realmIndexQueryEngine.cardDocument(
        new URL(instanceURL),
        {
          loadLinks: true,
          skipQueryBackedExpansion: isDuringPrerenderRequest(request),
        },
      );
      let doc: SingleCardDocument;
      if (!entry || entry?.type === 'error') {
        if (
          primarySerialization &&
          isBrowserTestEnv() &&
          !(globalThis as any).__emulateServerPatchFailure
        ) {
          doc = merge({}, primarySerialization, {
            data: {
              id: instanceURL,
              links: { self: instanceURL },
              meta: {
                ...(primarySerialization.data.meta ?? {}),
                lastModified,
              },
            },
          }) as SingleCardDocument;
        } else {
          return systemError({
            requestContext,
            message: `Unable to index card: can't find patched instance, ${instanceURL} in index`,
            id: instanceURL,
            additionalError: entry
              ? CardError.fromSerializableError(entry.error)
              : undefined,
          });
        }
      } else {
        doc = merge({}, entry.doc, {
          data: {
            links: { self: instanceURL },
            meta: { lastModified },
          },
        });
      }
      // Same rationale as the no-op short-circuit branch above:
      // cardDocument() above primed the realm-info cache via
      // attachRealmInfo(), but only when entry was a non-error doc.
      // On the error fallback we may still need to populate it.
      await this.getRealmInfo();
      let foreignDeps =
        entry && entry.type !== 'error'
          ? this.hasForeignRealmDeps(entry.deps)
          : false;
      let etag =
        entry && entry.type !== 'error' && !foreignDeps
          ? buildCardJsonEtag(entry.indexedAt, this.getCachedRealmInfoHash())
          : undefined;
      this.#serveInstanceIdsAsRRI(doc);
      return createResponse({
        body: JSON.stringify(doc, null, 2),
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

  private async getCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // Drain any in-flight incremental indexing before reading the card from
    // the index. With CS-11003's deferred +source POST, an immediately-
    // following GET +json after a definition rewrite would otherwise read
    // a stale snapshot — e.g. a post-rename instance still serialized
    // under the old schema. Read endpoints serve the realm's canonical
    // indexed view; the small wait when indexing is genuinely pending is
    // the right tradeoff vs returning stale state.
    let pending = this.incrementalIndexing();
    if (pending) {
      await pending;
    }
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
            Location: `${new URL(this.url).pathname}${canonicalPath}`,
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

      // Conditional-GET fast path. Only run the cheap `instance()`
      // peek when the client sent a validator — otherwise we'd be
      // paying an extra DB round-trip on cache misses since
      // `cardDocument()` below does its own `instance()` lookup.
      if (ifNoneMatch) {
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
            return notFound(request, requestContext);
          }
        }
        if (
          !this.hasForeignRealmDeps(instanceEntry.deps) &&
          instanceEntry.type === 'instance' &&
          instanceEntry.indexedAt != null
        ) {
          let etag = buildCardJsonEtag(instanceEntry.indexedAt, realmInfoHash);
          if (etag && ifNoneMatchMatches(ifNoneMatch, etag)) {
            return createResponse({
              requestContext,
              body: null,
              init: {
                status: 304,
                headers: {
                  etag,
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
      }

      // Cache miss (or the conditional was a non-match): assemble
      // the full doc. `cardDocument()` runs `attachRealmInfo()`
      // which (re)populates the realm-info cache, so the hash we
      // read for the response ETag below reflects the post-assembly
      // realm info.
      let maybeError = await this.#realmIndexQueryEngine.cardDocument(url, {
        loadLinks: true,
        skipQueryBackedExpansion: isDuringPrerenderRequest(request),
      });
      if (maybeError === undefined) {
        if (await this.nonJsonFileExists(localPath)) {
          let fileMeta = await this.fileMetaDocument(
            requestContext,
            localPath,
            SupportedMimeType.CardJson,
          );
          return fileMeta ?? notFound(request, requestContext);
        } else {
          return notFound(request, requestContext);
        }
      }
      if (maybeError.type === 'error') {
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
        let errorStatus = maybeError.error.errorDetail.status;
        return systemError({
          requestContext,
          status:
            errorStatus >= 400 && errorStatus <= 599 && errorStatus !== 404
              ? errorStatus
              : 500,
          message: `cannot return card, ${request.url}, from index: ${maybeError.error.errorDetail.title} - ${maybeError.error.errorDetail.message}`,
          id: request.url,
          additionalError: CardError.fromSerializableError(maybeError.error),
          // This is based on https://jsonapi.org/format/#errors
          body: {
            id: url.href,
            status: maybeError.error.errorDetail.status,
            title: maybeError.error.errorDetail.title,
            message: maybeError.error.errorDetail.message,
            // note that this is actually available as part of the response
            // header too--it's just easier for clients when it is here
            meta: {
              lastKnownGoodHtml: maybeError.error.lastKnownGoodHtml,
              cardTitle: maybeError.error.cardTitle,
              scopedCssUrls: maybeError.error.scopedCssUrls,
              stack: maybeError.error.errorDetail.stack,
            },
          },
        });
      }
      let { doc: card } = maybeError;
      card.data.links = { self: url.href };
      this.#serveInstanceIdsAsRRI(card);
      // Surface the instance's index-data generation
      // (`boxel_index.generation`) in per-instance `meta` so a consumer of the
      // card+json GET can tell fresh index data from stale. A fresh `meta`
      // object — never a mutation of the cached pristine doc's `meta`.
      card.data.meta = { ...card.data.meta, generation: maybeError.generation };

      // The 302 redirect for the `.json` form is now done up-front
      // (see top of method). Here we only need to redirect for the
      // legacy normalization case where `paths.fileURL(localPath)`
      // produces a different `paths.local()` than what we started
      // with — same as the prior implementation's behavior.
      let foundPath = this.paths.local(url);
      if (localPath !== foundPath) {
        return createResponse({
          requestContext,
          body: null,
          init: {
            status: 302,
            headers: { Location: `${new URL(this.url).pathname}${foundPath}` },
          },
        });
      }

      // Prefer created_at from DB for instance JSON
      let pathForDb = this.paths.local(url) + '.json';
      let createdAt = await this.getCreatedTime(pathForDb);
      // Use deps + indexedAt from the just-loaded doc — `cardDocument()`
      // saw a snapshot that may differ from the early peek if a write
      // landed between the two reads. Suppress the ETag if the doc
      // depends on foreign-realm cards: cross-realm invalidation
      // doesn't cascade `indexed_at`, so a validator we emit here
      // could 304 a follow-up request whose `included[]` should have
      // been re-fetched from the foreign realm.
      let foreignDeps = this.hasForeignRealmDeps(maybeError.deps);
      let responseEtag = foreignDeps
        ? undefined
        : buildCardJsonEtag(
            maybeError.indexedAt,
            this.getCachedRealmInfoHash(),
          );
      return createResponse({
        body: JSON.stringify(card, null, 2),
        init: {
          headers: {
            'content-type': SupportedMimeType.CardJson,
            'cache-control': cacheControl,
            ...(responseEtag ? { etag: responseEtag } : {}),
            ...etagSuppressedHeader(foreignDeps),
            ...lastModifiedHeader(card),
            ...(createdAt != null
              ? { 'x-created': formatRFC7231(createdAt * 1000) }
              : {}),
          },
        },
        requestContext,
      });
    } finally {
      this.#logRequestPerformance(request, start);
    }
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

    // Read endpoints serve the realm's canonical indexed view — drain any
    // in-flight incremental indexing first, exactly as `getCard` does.
    let pending = this.incrementalIndexing();
    if (pending) {
      await pending;
    }

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

    let doc = await this.#realmIndexQueryEngine.searchEntry(
      dbUrl,
      { htmlQuery, fieldset, kind },
      {
        loadLinks: true,
        ...(isDuringPrerenderRequest(request)
          ? { cacheOnlyDefinitions: true }
          : {}),
      },
    );
    if (!doc) {
      return notFound(request, requestContext);
    }

    // `searchEntry` ran `attachRealmInfo`, which (re)populated the realm-info
    // cache, so the hash we fold into an item-bearing response's ETag reflects
    // the realm info the item was just serialized with.
    let etag = buildEntryHtmlEtag(doc, this.getCachedRealmInfoHash());
    let ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, etag)) {
      return createResponse({
        requestContext,
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
          `markdown representation unavailable: ${request.url} has an indexing error`,
        );
      }
      if (instanceEntry.markdown == null) {
        return notAcceptable(
          request,
          requestContext,
          `markdown representation not available for ${request.url}`,
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
          `markdown representation not available for ${request.url}`,
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
    let result = await this.#realmIndexQueryEngine.cardDocument(url);
    if (!result) {
      return notFound(request, requestContext);
    }
    let path = this.paths.local(url) + '.json';
    await this.delete(path);
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
      // `!== undefined` so an explicit priority 0 (system-initiated) survives.
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
      ...(opts?.timings ? { timings: opts.timings } : {}),
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
      let doc = await this.searchEntries(searchEntryQuery, {
        cacheOnlyDefinitions: duringPrerender,
        // Inside a prerender the search skips the `loadLinks`
        // relationship-assembly pass entirely: the host re-resolves every
        // result from its raw card+source file, so the transitive
        // `included[]` expansion is throwaway work in this path.
        omitIncluded: duringPrerender,
      });
      return createResponse({
        body: JSON.stringify(doc, null, 2),
        init: {
          headers: { 'content-type': SupportedMimeType.CardJson },
        },
        requestContext,
      });
    } catch (e) {
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
      const filename = request.headers.get('X-Filename') || 'input.gts';
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
    let pending = this.incrementalIndexing();
    if (pending) {
      await pending;
    }
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
    // Same hazard publishability() guards against (see realm.ts:5629).
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
        // Source of truth is the row's `has_error` column — the SQL above
        // filters on it, so we mirror that filter when branching. Using
        // `row.error_doc != null` here would silently drop any row where
        // `has_error = TRUE` but `error_doc` is NULL.
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
        // All classes share the (entryType, url) key; the discriminator lets
        // consumers branch on which attributes to read.
        let baseAttributes = {
          url: row.url,
          entryType: row.type,
          diagnostics: row.diagnostics,
        };
        let findings: {
          type: 'indexing-error' | 'broken-link' | 'frontmatter-error';
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
    return await this.getRealmPermissions(request, requestContext);
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
      let results = (await query(this.#dbAdapter, [
        `SELECT show_as_catalog, publishable FROM realm_metadata WHERE url =`,
        param(this.url),
      ])) as {
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

  // CS-10054: read host routing rules from the indexed RealmConfig card.
  // The `instance` field is `linksTo(CardDef)`, so the indexed
  // searchDoc flattens each rule's link as `{ id, ...flattened
  // linked-card attrs }`. We only need the absolute `id` here.
  // Returns absolute URLs.
  async getHostRoutingMap(): Promise<{ path: string; id: string }[]> {
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
      let map = rules.flatMap((rule) => {
        if (!rule || typeof rule !== 'object') return [];
        let path = (rule as Record<string, unknown>).path;
        let instance = (rule as Record<string, unknown>).instance;
        if (typeof path !== 'string') return [];
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
            `dropping host routing rule for path "${path}" — target ${id} is outside this realm`,
          );
          return [];
        }
        return [{ path, id }];
      });
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

  async getRealmInfo(): Promise<RealmInfo> {
    if (!this.#cachedRealmInfo) {
      this.#cachedRealmInfo = await this.parseRealmInfo();
      this.#cachedRealmInfoHash = computeContentHash(
        JSON.stringify(this.#cachedRealmInfo),
      );
    }
    return this.#cachedRealmInfo;
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
    this.#cachedRealmInfo = null;
    this.#cachedRealmInfoHash = null;
  }

  private async parseRealmInfo(): Promise<RealmInfo> {
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
      }
    } catch (e) {
      this.#log.warn(`failed to read RealmConfig card from index: ${e}`);
    }

    return realmInfo;
  }

  private async realmInfo(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let realmInfo = await this.parseRealmInfo();

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
      let { invalidations, generation } =
        await this.updateIndexAndCollectInvalidations([url], {
          ...(operation === 'removed' ? { delete: true } : {}),
        });
      this.broadcastIncrementalInvalidationEvent(invalidations, { generation });
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

function lastModifiedHeader(
  card: LooseSingleCardDocument,
): {} | { 'last-modified': string } {
  return (
    card.data.meta.lastModified != null
      ? { 'last-modified': formatRFC7231(card.data.meta.lastModified * 1000) }
      : {}
  ) as {} | { 'last-modified': string };
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

function promoteLocalIdsToRemoteIds({
  resource,
  realmURL,
  included,
}: {
  resource: CardResource;
  included: CardResource[];
  realmURL: URL;
}) {
  if (!resource.relationships) {
    return;
  }
  let normalizedRelationships = normalizeRelationships(resource.relationships);

  function setSelfLink(relationship: Relationship, lid: string) {
    let sideLoadedResource = included.find((i) => i.lid === lid);
    if (!sideLoadedResource) {
      throw new Error(`Could not find local id ${lid} in "included" resources`);
    }
    if (
      sideLoadedResource.meta.realmURL &&
      sideLoadedResource.meta.realmURL !== realmURL.href
    ) {
      return;
    }
    let name = getCardDirectoryName(sideLoadedResource.meta?.adoptsFrom, paths);
    relationship.links = {
      self: paths.fileURL(`${name}/${lid}`).href,
    };
  }

  let paths = new RealmPaths(realmURL);
  for (let [fieldName, relationship] of Object.entries(
    normalizedRelationships,
  )) {
    if (relationship.data && Array.isArray(relationship.data)) {
      for (let [index, item] of relationship.data.entries()) {
        if ('lid' in item) {
          let indexedRelationship =
            normalizedRelationships[`${fieldName}.${index}`];
          if (indexedRelationship) {
            setSelfLink(indexedRelationship, item.lid);
          }
        }
      }
      continue;
    }
    if (
      relationship.data &&
      !Array.isArray(relationship.data) &&
      'lid' in relationship.data
    ) {
      setSelfLink(relationship, relationship.data.lid);
    }
  }
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
