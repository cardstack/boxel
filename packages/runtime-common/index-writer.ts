import { flatten } from 'lodash-es';
import { flattenDeep } from 'lodash-es';
import {
  type CardResource,
  type JobInfo,
  jobIdentity,
  trimExecutableExtension,
  hasExecutableExtension,
  RealmPaths,
  unixTime,
  logger,
} from './index.ts';
import {
  rri,
  type RealmResourceIdentifier,
  type RealmIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import {
  getCreatedTime,
  ensureFileCreatedAt,
  getContentMeta,
  getFileMetaForPaths,
} from './file-meta.ts';
import {
  type Expression,
  param,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
  every,
  any,
  query,
  upsert,
  dbExpression,
  upsertMultipleRows,
} from './expression.ts';
import {
  clampSerializedError,
  sanitizeForJsonb,
  type SerializedError,
} from './error.ts';
import type { DBAdapter } from './db.ts';
import type { RealmMetaTable } from './index-structure.ts';
import type { FileMetaResource } from './resource-types.ts';
import type { Diagnostics } from './index.ts';
import {
  coerceTypes,
  type BoxelIndexTable,
  type CardTypeSummary,
  type PrerenderedHtmlTable,
  type RealmGenerationsTable,
} from './index-structure.ts';
import { v4 as uuidv4 } from '@lukeed/uuid';

export class IndexWriter {
  #dbAdapter: DBAdapter;
  constructor(dbAdapter: DBAdapter) {
    this.#dbAdapter = dbAdapter;
  }

  async createBatch(
    realmURL: URL,
    virtualNetwork: VirtualNetwork,
    jobInfo?: JobInfo,
    opts?: {
      splitPrerenderHtml?: boolean;
      prerenderHtmlOnly?: boolean;
      generation?: number;
    },
  ) {
    let batch = new Batch(
      this.#dbAdapter,
      realmURL,
      virtualNetwork,
      jobInfo,
      opts,
    );
    await batch.ready;
    return batch;
  }

  #query(expression: Expression) {
    return query(this.#dbAdapter, expression, coerceTypes);
  }

  async isNewIndex(realm: URL): Promise<boolean> {
    let [row] = (await this.#query([
      'SELECT current_generation FROM realm_generations WHERE realm_url =',
      param(realm.href),
    ])) as Pick<RealmGenerationsTable, 'current_generation'>[];
    return !row;
  }
}

export type IndexEntry = InstanceEntry | IndexErrorEntry | FileEntry;
export type LastModifiedTimes = Map<
  string,
  { type: string; lastModified: number | null; hasError: boolean }
>;

export interface InstanceEntry {
  type: 'instance';
  lastModified: number;
  resourceCreatedAt: number;
  resource: CardResource;
  searchData: Record<string, any>;
  // The visit's HTML half. A fused batch's `updateEntry` lands these on the
  // prerendered_html channel; a split-mode index visit produces none (its
  // spawned `prerender_html` job renders them on its own channel instead).
  // `iconHTML` is the exception — the icon renders in the index visit and is
  // written to `boxel_index.icon_html` in both modes.
  isolatedHtml?: string;
  headHtml?: string;
  embeddedHtml?: Record<string, string>;
  fittedHtml?: Record<string, string>;
  atomHtml?: string;
  iconHTML?: string;
  markdown?: string;
  types: string[];
  displayNames: string[];
  deps: Set<string>;
  // Per-row render timing diagnostics (launch/waits/render timings
  // plus host-side breadcrumbs). Populated from the Prerenderer's
  // `response.meta` and persisted onto `boxel_index.diagnostics`.
  // Not tied to `has_error` — we persist this for successful rows too
  // so operators can retrospectively answer "why did this instance
  // take N seconds on the last reindex?".
  diagnostics?: Diagnostics;
}

export interface IndexErrorEntry {
  type: 'instance-error' | 'file-error';
  error: SerializedError;
  types?: string[];
  searchData?: Record<string, any>;
  cardType?: string;
  // See InstanceEntry.diagnostics. On the error path, the
  // same payload is also copied into `error_doc.diagnostics` at
  // write time so the UI read path keeps working unchanged.
  diagnostics?: Diagnostics;
}

export type InstanceErrorIndexEntry = IndexErrorEntry & {
  type: 'instance-error';
};
export type FileErrorIndexEntry = IndexErrorEntry & { type: 'file-error' };
export type SearchIndexErrorEntry =
  | InstanceErrorIndexEntry
  | FileErrorIndexEntry;
export type SearchIndexEntry =
  | InstanceEntry
  | SearchIndexErrorEntry
  | FileEntry;

export interface DependencyIndexRow {
  url: string;
  type: BoxelIndexTable['type'];
  deps: string[] | null;
  hasError: boolean;
  isDeleted: boolean;
  errorDoc: SerializedError | null;
}

function isErrorEntry(entry: { type: string }): entry is IndexErrorEntry {
  return entry.type === 'instance-error' || entry.type === 'file-error';
}

export interface FileEntry {
  type: 'file';
  lastModified: number;
  resourceCreatedAt: number;
  deps: Set<string>;
  searchData?: Record<string, any>;
  resource?: FileMetaResource | null;
  types?: string[];
  displayNames?: string[];
  // See InstanceEntry: the visit's HTML half, landed on the prerendered_html
  // channel by a fused batch; `iconHTML` goes to `boxel_index.icon_html`.
  isolatedHtml?: string;
  headHtml?: string;
  embeddedHtml?: Record<string, string>;
  fittedHtml?: Record<string, string>;
  atomHtml?: string;
  iconHTML?: string;
  markdown?: string;
  // See InstanceEntry.diagnostics.
  diagnostics?: Diagnostics;
}

// The per-URL write payloads of a `prerenderHtmlOnly` batch — the HTML half
// of an index entry. `PrerenderedHtmlEntry` lands a fresh rendering;
// `PrerenderedHtmlErrorEntry` records a render failure while preserving the
// last-known-good HTML already in production `prerendered_html`.
export interface PrerenderedHtmlEntry {
  type: 'instance' | 'file';
  isolatedHtml?: string | null;
  headHtml?: string | null;
  embeddedHtml?: Record<string, string> | null;
  fittedHtml?: Record<string, string> | null;
  atomHtml?: string | null;
  markdown?: string | null;
  deps: string[];
  // The prerender-html visit's render diagnostics (launch/wait timings,
  // render elapsed, per-format render timings, `prerenderHtmlRequestId`).
  // Persisted onto `prerendered_html.diagnostics` — the render-channel
  // analog of `InstanceEntry.diagnostics`, populated for successful rows
  // too so operators can retrospectively answer "why did this rendering
  // take N seconds?".
  diagnostics?: Diagnostics;
}

export interface PrerenderedHtmlErrorEntry {
  type: 'instance-error' | 'file-error';
  error: SerializedError;
  // See PrerenderedHtmlEntry.diagnostics: the failing render's own
  // breakdown. Also mirrored onto `error_doc.diagnostics` at write time,
  // matching the `boxel_index` error-row pattern.
  diagnostics?: Diagnostics;
}

// The invalidation set an index pass threads to its `prerender_html` job:
// each URL tagged with whether it is a genuine deletion (stays tombstoned)
// or a re-render. Structurally identical to `IncrementalChange`
// (tasks/indexer.ts) — declared here so the writer layer doesn't import
// from the task layer.
export interface PrerenderedHtmlChange {
  url: string;
  operation: 'update' | 'delete';
}

// The HTML half of a fused-visit index entry, in the shape the
// prerendered_html writer consumes. A fused visit produces one combined
// index+render diagnostics blob; the whole blob rides on both channels'
// rows.
function prerenderedHtmlEntryFrom(
  entry: SearchIndexEntry,
  diagnostics: Diagnostics,
): PrerenderedHtmlEntry | PrerenderedHtmlErrorEntry {
  if (isErrorEntry(entry)) {
    return { type: entry.type, error: entry.error, diagnostics };
  }
  return {
    type: entry.type,
    isolatedHtml: entry.isolatedHtml ?? null,
    headHtml: entry.headHtml ?? null,
    embeddedHtml: entry.embeddedHtml ?? null,
    fittedHtml: entry.fittedHtml ?? null,
    atomHtml: entry.atomHtml ?? null,
    markdown: entry.markdown ?? null,
    deps: [...entry.deps],
    diagnostics,
  };
}

// Rows held in the write-behind buffer before a flush is forced (see
// `Batch.bufferEntry`). Dependency reads flush earlier; this only bounds
// memory across long runs of dependency-free files. Renders dwarf the writes,
// so even a forced flush lands in a render's shadow.
const WRITE_BUFFER_FLUSH_THRESHOLD = 100;

export class Batch {
  readonly ready: Promise<void>;
  #invalidations = new Set<string>();
  #nodeResolvedInvalidations: string[] | undefined;
  // URLs already written to boxel_index_working by an earlier attempt
  // of *this same job*, with the last_modified value the previous
  // attempt observed. Populated during `ready`. The visit loop in
  // IndexRunner consults this map to skip work the previous attempt
  // already finished; the from-scratch path additionally compares the
  // stored last_modified against the current EFS mtime so a file that
  // changed mid-attempt is re-visited rather than silently resumed
  // with stale content.
  #resumedRows = new Map<string, number | null>();
  #tombstonedLiveTypes = new Map<string, BoxelIndexTable['type'][]>();
  // Correlation ID minted once per Batch and stamped into every row's
  // `diagnostics` via `updateEntry`, so operators can
  // `SELECT ... WHERE diagnostics->>'invalidationId' = '...'`
  // and see every row that was part of the same indexing fan-out in
  // one query. Minted in the constructor (not `invalidate()`) so
  // fromScratch — which doesn't call `invalidate()` — still gets a
  // correlation ID covering the whole rebuild. Refreshed at the top
  // of each incremental `invalidate()` call so the ID identifies a
  // single triggering change, not the whole batch lifetime.
  #currentInvalidationId: string;
  // Write-behind buffer for the index visit loop (see `bufferEntry`). Rows
  // accumulate here so the prerender tab renders the next file while these
  // drain; `#writeBufferUrls` mirrors their URLs for the dependency-read
  // flush check in `getDependencyRows`.
  #writeBuffer: { url: URL; entry: SearchIndexEntry }[] = [];
  #writeBufferUrls = new Set<string>();
  // Aggregate wall of every physical `boxel_index_working` write in this
  // batch, surfaced on the job result's `phaseTimings.writeMs`.
  #writeMs = 0;
  #dbAdapter: DBAdapter;
  #perfLog = logger('index-perf');
  // The source realm of a copy batch, set by `copyFrom`. `applyBatchUpdates`
  // uses it to fill the destination's prerendered_html channel from the
  // source realm's `prerendered_html` rows.
  #copyFromSourceRealm: URL | undefined;
  // When true (the server/Postgres path), HTML prerendering runs as a separate
  // `prerender_html` job, so this index batch writes only `boxel_index` and
  // leaves the `prerendered_html` channel to that job. When false (the fused
  // path — the SQLite in-browser/test realm, which has no separate worker), the
  // batch writes each entry's HTML half into `prerendered_html_working` inline
  // (in `updateEntry`, with tombstones mirrored in `tombstoneEntries`).
  // Defaults to `dbAdapter.kind === 'pg'`; a copy batch fills the channel
  // either way via `copyPrerenderedHtmlFrom` (guarded by
  // `#copyFromSourceRealm` in `applyBatchUpdates`).
  #splitPrerenderHtml: boolean;
  // When true, this batch is the `prerender_html` job's batch: it writes only
  // the `prerendered_html` channel (not `boxel_index`), stamps the carried
  // generation without advancing `realm_generations`, and its swap carries a
  // monotonic guard. The tombstone / last-known-good / resume / write logic is
  // otherwise identical to an index batch — the fan-out is not recomputed here
  // (it ran once in the index pass and is seeded via
  // `seedPrerenderedHtmlInvalidations`).
  #prerenderHtmlOnly: boolean;
  #explicitGeneration: number | undefined;
  #priorLoaderEpoch = '0';
  #mintedLoaderEpoch: string | undefined;
  #hasExecutableInvalidation = false;
  #scannedInvalidationCount = 0;
  // Created-at + content hash/size for files this batch will visit, loaded in
  // one query by `prefetchFileMeta` so the per-visit `ensureFileCreatedAt` /
  // `getContentMeta` lookups the index loop makes are served from memory rather
  // than a DB round-trip each. Only files with a persisted `realm_file_meta`
  // row are present; a miss falls back to the per-path read, so both lookups
  // behave identically whether or not the batch prefetched.
  #fileMetaCache = new Map<
    string,
    {
      createdAt: number;
      contentHash: string | undefined;
      contentSize: number | undefined;
    }
  >();
  declare private generation: number;
  private realmURL: URL; // this assumes that we only index cards in our own realm...
  private virtualNetwork: VirtualNetwork;
  private jobInfo?: JobInfo;

  constructor(
    dbAdapter: DBAdapter,
    realmURL: URL,
    virtualNetwork: VirtualNetwork,
    jobInfo?: JobInfo,
    opts?: {
      splitPrerenderHtml?: boolean;
      prerenderHtmlOnly?: boolean;
      generation?: number;
    },
  ) {
    this.realmURL = realmURL;
    this.virtualNetwork = virtualNetwork;
    this.jobInfo = jobInfo;
    this.#dbAdapter = dbAdapter;
    this.#splitPrerenderHtml =
      opts?.splitPrerenderHtml ?? dbAdapter.kind === 'pg';
    this.#prerenderHtmlOnly = opts?.prerenderHtmlOnly ?? false;
    this.#explicitGeneration = opts?.generation;
    this.#currentInvalidationId = uuidv4();
    this.ready = this.setupBatch();
  }

  // Whether this batch defers HTML to the `prerender_html` job (server) rather
  // than projecting it inline (fused / SQLite). Read by the index-runner visit
  // loop (to skip the inline prerender-html visit) and the enqueue callback.
  get splitPrerenderHtml(): boolean {
    return this.#splitPrerenderHtml;
  }

  // The realm generation this batch stamps on every row it writes
  // (`current_generation + 1`, computed at batch start). Threaded out so the
  // index event and the spawned `prerender_html` job can carry it.
  get currentGeneration(): number {
    return this.generation;
  }

  // The loader epoch this batch's renders thread into the /render route:
  // a freshly minted token when the invalidation set includes executable
  // modules (their bytes changed, so warm prerender-tab loaders are stale),
  // otherwise the epoch already committed for the realm. The route resets
  // its loader when a render's epoch differs from the one the tab last
  // cleared for, so module edits cost one loader reset per tab while
  // instance-only passes keep every loader warm. The invalidation set only
  // grows, so the executable scan memoizes: once an executable is seen the
  // answer is final, and unchanged set sizes skip re-scanning.
  get loaderEpoch(): string {
    if (
      !this.#hasExecutableInvalidation &&
      this.#invalidations.size !== this.#scannedInvalidationCount
    ) {
      this.#hasExecutableInvalidation = [...this.#invalidations].some((url) =>
        hasExecutableExtension(url),
      );
      this.#scannedInvalidationCount = this.#invalidations.size;
    }
    if (this.#hasExecutableInvalidation) {
      return (this.#mintedLoaderEpoch ??= uuidv4());
    }
    return this.#priorLoaderEpoch;
  }

  // Feed URLs into the loader-epoch executable scan without adding them to
  // the batch's invalidation set. The from-scratch pass determines its URL
  // list outside `invalidate()` (rows join `#invalidations` one visit at a
  // time via `updateEntry`), so without this the epoch read at announce
  // time — and by the pass's early visits — would predate the module scan
  // and disagree with the epoch the pass ultimately commits.
  noteInvalidatedURLs(urls: string[]): void {
    if (!this.#hasExecutableInvalidation) {
      this.#hasExecutableInvalidation = urls.some((url) =>
        hasExecutableExtension(url),
      );
    }
  }

  private isRegisteredPrefix(reference: string): boolean {
    return this.virtualNetwork.isRegisteredPrefix(reference);
  }

  private unresolveURL(url: string): string {
    return this.virtualNetwork.unresolveURL(url);
  }

  private async setupBatch(): Promise<void> {
    if (this.#prerenderHtmlOnly) {
      // The `prerender_html` job stamps the generation its spawning index
      // pass anticipated — it never advances `realm_generations` (the
      // monotonic swap guard in `done()` is what keeps out-of-order jobs
      // safe, not the generation being exact).
      if (this.#explicitGeneration == null) {
        throw new Error(
          `a prerenderHtmlOnly batch requires an explicit generation`,
        );
      }
      this.generation = this.#explicitGeneration;
      await this.loadResumedPrerenderedHtmlRows();
      return;
    }
    await this.setNextGeneration();
    await this.loadResumedRows();
  }

  private async loadResumedRows(): Promise<void> {
    if (!this.jobInfo || this.jobInfo.jobId <= 0) {
      return;
    }
    // Exclude `has_error = true` rows. A retry exists precisely so a
    // transient failure (renderer hang, network blip, OOM) gets a
    // second chance — preserving the prior error row would freeze
    // the URL in the failed state until some unrelated change kicks
    // a different job. Tombstones (`is_deleted = true`) are
    // similarly excluded so the deletion intent flows through to
    // `applyBatchUpdates` instead of being skipped as resumed work.
    let rows = (await this.#query([
      `SELECT url, last_modified FROM boxel_index_working WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['job_id =', param(this.jobInfo.jobId)],
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
        any([['has_error = false'], ['has_error IS NULL']]),
      ]),
    ] as Expression)) as Pick<BoxelIndexTable, 'url' | 'last_modified'>[];
    for (let { url, last_modified } of rows) {
      this.#resumedRows.set(
        url,
        last_modified == null ? null : parseInt(last_modified),
      );
      // Pre-seed the in-memory invalidation set so `applyBatchUpdates`
      // promotes the resumed rows even though no `updateEntry` /
      // `invalidate` call in this attempt added them. Without this,
      // resumed work would sit in the working table indefinitely
      // because the SELECT ... INTO boxel_index keys on
      // `#invalidations`.
      this.#invalidations.add(url);
    }
    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} resuming ${this.#resumedRows.size} URLs from prior attempt for ${this.realmURL.href}`,
    );
  }

  // The `prerendered_html` analog of `loadResumedRows`, for a
  // `prerenderHtmlOnly` batch: resume from `prerendered_html_working` rows a
  // prior attempt of this same job already rendered. Tombstones are excluded
  // so the deletion intent flows through to the swap, and error rows are
  // excluded so a transient render failure gets a second chance (the table
  // has no `has_error` column; an error row is `error_doc IS NOT NULL`).
  // There is no mtime to record — `args.changes` is the job's deterministic
  // seed, so a resumed row is always authoritative for this job.
  private async loadResumedPrerenderedHtmlRows(): Promise<void> {
    if (!this.jobInfo || this.jobInfo.jobId <= 0) {
      return;
    }
    let rows = (await this.#query([
      `SELECT url FROM prerendered_html_working WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['job_id =', param(this.jobInfo.jobId)],
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
        ['error_doc IS NULL'],
      ]),
    ] as Expression)) as Pick<PrerenderedHtmlTable, 'url'>[];
    for (let { url } of rows) {
      this.#resumedRows.set(url, null);
      // Pre-seed the invalidation set so the swap in `done()` promotes the
      // resumed rows even though this attempt never re-writes them.
      this.#invalidations.add(url);
    }
    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} resuming ${this.#resumedRows.size} prerendered-html URLs from prior attempt for ${this.realmURL.href}`,
    );
  }

  /**
   * URLs already processed by an earlier attempt of this job. The map
   * value is the `last_modified` the previous attempt observed (null
   * for tombstones / file rows without an mtime). The from-scratch
   * caller compares this against the current EFS mtime to decide
   * whether the resumed row is still authoritative.
   */
  get resumedRows(): ReadonlyMap<string, number | null> {
    return this.#resumedRows;
  }

  /**
   * Row types `tombstoneEntries` overwrote with tombstones this pass,
   * restricted to rows that were live (not already deleted) in the
   * production index. IndexRunner's per-file failure isolation consults
   * this to decide whether a failed URL had a card instance to protect —
   * the index is a more reliable oracle than re-reading the file, since
   * the read path may be exactly what failed.
   */
  tombstonedLiveTypes(url: string): BoxelIndexTable['type'][] | undefined {
    return this.#tombstonedLiveTypes.get(url);
  }

  /**
   * Drop URLs from the resumed-row map. Call this when the caller has
   * concluded the previous attempt's content for those URLs is no
   * longer authoritative — typically because the file has been
   * deleted from disk between attempts. After calling this,
   * `tombstoneEntries` will tombstone the URLs normally and
   * `applyBatchUpdates` will promote the tombstones to
   * `boxel_index`, so the deletion lands.
   */
  forgetResumedRows(urls: string[]): void {
    for (let url of urls) {
      this.#resumedRows.delete(url);
    }
  }

  get invalidations() {
    return [...this.#invalidations];
  }

  get currentInvalidationId(): string {
    return this.#currentInvalidationId;
  }

  // Look up created_at for a given file path from realm_file_meta
  async getCreatedTime(localPath: string): Promise<number | undefined> {
    // delegate to shared helper
    return getCreatedTime(this.#dbAdapter, this.realmURL.href, localPath);
  }

  // Load created_at + content hash/size for a set of files in one query so the
  // per-visit `ensureFileCreatedAt` / `getContentMeta` lookups are served from
  // memory. The visit loop knows its whole URL set up front, so one batched
  // read replaces two DB round-trips per visit — the same shape as
  // `getModifiedTimes` fetching mtimes up front. The cached hash/size is a
  // snapshot as of this call: a file rewritten between the prefetch and its
  // visit (`persistFileMeta` overwrites the columns) is served the pre-rewrite
  // values, and the concurrent write's own incremental pass re-indexes it with
  // the current metadata — the same eventual-consistency the per-visit read had
  // over the narrower read-file-to-lookup window. Calling this again merges
  // fresh rows in, so overlapping sets are safe.
  async prefetchFileMeta(localPaths: string[]): Promise<void> {
    let fetched = await getFileMetaForPaths(
      this.#dbAdapter,
      this.realmURL.href,
      localPaths,
    );
    for (let [path, meta] of fetched) {
      this.#fileMetaCache.set(path, meta);
    }
  }

  // Ensure a created_at row exists for this file in realm_file_meta and return
  // it. A prefetched hit means the row already exists, so its created_at is
  // returned without a round-trip; a miss falls through to the per-path
  // ensure-and-read, which also creates the row when the file has none.
  async ensureFileCreatedAt(localPath: string): Promise<number> {
    let cached = this.#fileMetaCache.get(localPath);
    if (cached) {
      return cached.createdAt;
    }
    return ensureFileCreatedAt(this.#dbAdapter, this.realmURL.href, localPath);
  }

  // Look up the content hash and size persisted at write time for a given file
  // path. Served from the prefetch cache when available; otherwise a single row
  // lookup. Either value is undefined when the realm has no recorded value
  // (e.g. files written before file-meta hashing existed, or a no-op rewrite
  // that left the columns untouched).
  async getContentMeta(localPath: string): Promise<{
    contentHash: string | undefined;
    contentSize: number | undefined;
  }> {
    let cached = this.#fileMetaCache.get(localPath);
    if (cached) {
      return {
        contentHash: cached.contentHash,
        contentSize: cached.contentSize,
      };
    }
    return getContentMeta(this.#dbAdapter, this.realmURL.href, localPath);
  }

  private get nodeResolvedInvalidations() {
    return (this.#nodeResolvedInvalidations ??= [...this.invalidations].map(
      (href) => trimExecutableExtension(rri(href)),
    ));
  }

  async getModifiedTimes(): Promise<LastModifiedTimes> {
    let results = (await this.#query([
      `SELECT i.url, i.type, i.last_modified, i.has_error
       FROM boxel_index as i
          WHERE`,
      ...every([[`i.realm_url =`, param(this.realmURL.href)]]),
    ] as Expression)) as Pick<
      BoxelIndexTable,
      'url' | 'type' | 'last_modified' | 'has_error'
    >[];
    let result: LastModifiedTimes = new Map();
    for (let { url, type, last_modified: lastModified, has_error } of results) {
      result.set(url, {
        type,
        // lastModified is unix time, so it should be safe to cast to number
        lastModified: lastModified == null ? null : parseInt(lastModified),
        hasError: Boolean(has_error),
      });
    }
    return result;
  }

  async copyFrom(sourceRealmURL: URL): Promise<void> {
    let columns: string[][] | undefined;
    let sources = (await this.#query([
      `SELECT * FROM boxel_index WHERE`,
      // intentionally copying over error docs--perhaps these can be resolved in
      // the new realm?
      ...every([
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
        [`realm_url =`, param(sourceRealmURL.href)],
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    let now = String(Date.now());
    let copyURL = (value: string) =>
      this.isRegisteredPrefix(value)
        ? value
        : this.copiedRealmURL(sourceRealmURL, new URL(value)).href;
    let values = sources.map((entry) => {
      let destURL = copyURL(entry.url);
      this.#invalidations.add(destURL);
      entry.url = destURL;
      entry.realm_url = this.realmURL.href;
      entry.generation = this.generation;
      entry.job_id = this.jobInfo?.jobId ?? null;
      entry.file_alias = copyURL(entry.file_alias);
      entry.types = entry.types ? entry.types.map(copyURL) : entry.types;
      entry.deps = entry.deps ? entry.deps.map(copyURL) : entry.deps;
      entry.last_known_good_deps = entry.last_known_good_deps
        ? entry.last_known_good_deps.map(copyURL)
        : entry.last_known_good_deps;
      entry.pristine_doc = entry.pristine_doc
        ? {
            ...entry.pristine_doc,
            id: copyURL(entry.pristine_doc.id!) as RealmResourceIdentifier, // these will always have an ID
          }
        : entry.pristine_doc;
      if (entry.type === 'instance' && entry.pristine_doc) {
        entry.pristine_doc.meta = {
          ...entry.pristine_doc.meta,
          realmURL: this.realmURL.href as RealmIdentifier,
        };
      }
      this.updateIds(entry.search_doc, sourceRealmURL);
      if (entry.error_doc) {
        entry.error_doc = this.normalizeErrorDoc(
          entry.error_doc,
          new URL(entry.url),
          (dep) => this.copiedRealmURL(sourceRealmURL, dep),
        );
      }
      entry.indexed_at = now;

      let { valueExpressions, nameExpressions } = asExpressions(entry);
      columns = nameExpressions;
      return valueExpressions;
    });
    if (!columns) {
      throw new Error(
        `nothing to copy from ${sourceRealmURL.href} - this realm is not present on the realm server`,
      );
    }

    await this.#query([
      ...upsertMultipleRows(
        'boxel_index_working',
        'boxel_index_working_pkey',
        columns,
        values,
      ),
    ]);

    // `applyBatchUpdates` fills the destination's prerendered_html channel
    // from the source realm's `prerendered_html` rows.
    this.#copyFromSourceRealm = sourceRealmURL;
  }

  // Copy the source realm's `prerendered_html` rows onto the destination's
  // `prerendered_html_working`, so a copied realm keeps its prerendered HTML
  // without re-rendering. Runs from `applyBatchUpdates` just before the
  // channel swap. A destination URL whose source has no `prerendered_html`
  // row gets none — it reads as unrendered and the catch-up sweep enqueues
  // its render. Mirrors the `boxel_index` copy's transforms — URL rewrite
  // (`url`, `realm_url`, `file_alias`), render-type-key rewrite of
  // `fitted_html` / `embedded_html`, deps rewrite (scoped-CSS URLs ride in
  // `deps`), and `error_doc` normalization — and stamps the destination
  // generation so the copied instances read as fresh
  // (`prerendered_html.generation == boxel_index.generation`). Tombstoned
  // source rows are skipped, matching the `boxel_index` copy.
  private async copyPrerenderedHtmlFrom(sourceRealmURL: URL): Promise<void> {
    let now = String(Date.now());
    let sources = (await this.#query([
      `SELECT * FROM prerendered_html WHERE`,
      ...every([
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
        [`realm_url =`, param(sourceRealmURL.href)],
      ]),
    ] as Expression)) as unknown as PrerenderedHtmlTable[];
    let copyURL = (value: string) =>
      this.isRegisteredPrefix(value)
        ? value
        : this.copiedRealmURL(sourceRealmURL, new URL(value)).href;
    let columns: string[][] | undefined;
    let values = sources.map((entry) => {
      let destURL = copyURL(entry.url);
      // The source's `prerendered_html` rows are a subset of its `boxel_index`
      // rows, so `copyFrom` already seeded these into `#invalidations`; add
      // defensively so the swap below promotes every overlaid HTML row.
      this.#invalidations.add(destURL);
      entry.url = destURL;
      entry.realm_url = this.realmURL.href;
      entry.file_alias = copyURL(entry.file_alias);
      entry.generation = this.generation;
      entry.rendered_at = now;
      entry.job_id = this.jobInfo?.jobId ?? null;
      entry.deps = entry.deps ? entry.deps.map(copyURL) : entry.deps;
      entry.last_known_good_deps = entry.last_known_good_deps
        ? entry.last_known_good_deps.map(copyURL)
        : entry.last_known_good_deps;
      entry.fitted_html = entry.fitted_html
        ? this.objectWithCopiedRealmKeys(sourceRealmURL, entry.fitted_html)
        : entry.fitted_html;
      entry.embedded_html = entry.embedded_html
        ? this.objectWithCopiedRealmKeys(sourceRealmURL, entry.embedded_html)
        : entry.embedded_html;
      if (entry.error_doc) {
        entry.error_doc = this.normalizeErrorDoc(
          entry.error_doc,
          new URL(entry.url),
          (dep) => this.copiedRealmURL(sourceRealmURL, dep),
        );
      }
      let { valueExpressions, nameExpressions } = asExpressions(entry);
      columns = nameExpressions;
      return valueExpressions;
    });
    if (!columns) {
      // Source realm has no prerendered HTML to copy (e.g. never rendered);
      // the destination reads as unrendered and the catch-up sweep enqueues
      // its renders.
      return;
    }

    await this.#query([
      ...upsertMultipleRows(
        'prerendered_html_working',
        'prerendered_html_working_pkey',
        columns,
        values,
      ),
    ]);
  }

  // Enqueue a row write behind the write buffer instead of upserting it
  // inline. The index visit loop routes its writes here so the prerender tab
  // can start the next file's render while these rows drain. The URL joins
  // `#invalidations` synchronously — the swap in `done()`, the resume marker,
  // and the dependency-error skip all key off it, so buffering must not defer
  // that — while the physical upsert is held until `flushWriteBuffer`. The one
  // mid-pass reader of buffered rows, dependency-error bookkeeping via
  // `getDependencyRows`, flushes the buffer first when it queries a
  // still-buffered URL, so a dependent never reads a stale row for a
  // dependency written earlier in the same pass.
  async bufferEntry(url: URL, entry: SearchIndexEntry): Promise<void> {
    if (this.#prerenderHtmlOnly) {
      throw new Error(
        `a prerenderHtmlOnly batch writes only the prerendered_html channel — use updatePrerenderedHtmlEntry`,
      );
    }
    if (!new RealmPaths(this.realmURL, this.virtualNetwork).inRealm(url)) {
      // TODO this is a workaround for CS-6886. after we have solved that issue we can
      // drop this band-aid
      return;
    }
    this.#assertErrorEntryHasMessage(url, entry);
    this.#invalidations.add(url.href);
    this.#writeBuffer.push({ url, entry });
    this.#writeBufferUrls.add(url.href);
    // Bound memory for long runs of dependency-free files; dependency reads
    // flush earlier. Renders dwarf the writes, so a forced flush here still
    // rides in the shadow of the render that started before it.
    if (this.#writeBuffer.length >= WRITE_BUFFER_FLUSH_THRESHOLD) {
      await this.flushWriteBuffer();
    }
  }

  // Drain the write buffer. In split mode (server / pg) the batch writes only
  // `boxel_index`, so the held rows coalesce into multi-row upserts grouped by
  // column signature — instance/file success rows share one signature, error
  // rows fold in the last-known-good production columns and group separately —
  // turning one round-trip per row into a handful per drain. In fused mode
  // (SQLite) each row also lands its HTML half on the `prerendered_html`
  // channel, so the proven per-row path runs instead.
  async flushWriteBuffer(): Promise<void> {
    if (this.#writeBuffer.length === 0) {
      return;
    }
    let buffered = this.#writeBuffer;
    let start = Date.now();
    try {
      if (this.#splitPrerenderHtml) {
        // Last write wins when the same (url, type) was buffered twice: a
        // single multi-row upsert can't touch one conflict target twice.
        let deduped = new Map<string, { url: URL; entry: SearchIndexEntry }>();
        for (let item of buffered) {
          deduped.set(`${item.url.href}|${rowType(item.entry)}`, item);
        }
        let prepared = await Promise.all(
          [...deduped.values()].map(({ url, entry }) =>
            this.#prepareIndexRow(url, entry),
          ),
        );
        await this.#upsertIndexRows(prepared);
      } else {
        for (let { url, entry } of buffered) {
          await this.#writeEntryNow(url, entry);
        }
      }
      // Clear only after the rows have durably landed. If a write throws, the
      // buffer is retained so the healthy rows in it aren't lost: a later
      // flush (the next dependency read, the size cap, or `done()`) retries
      // them. `done()` flushes before it promotes, so a persistent failure
      // surfaces there and aborts the batch before any swap — rather than
      // dropping the buffered rows while their URLs stay in the invalidation
      // set, which would let the swap promote tombstones or stale rows.
      this.#writeBuffer = [];
      this.#writeBufferUrls.clear();
    } finally {
      this.#writeMs += Date.now() - start;
    }
  }

  // Aggregate wall of every physical `boxel_index_working` write in this
  // batch — the single-row `updateEntry` path plus every `flushWriteBuffer`
  // drain — surfaced on the job result's `phaseTimings.writeMs`.
  get writeMs(): number {
    return this.#writeMs;
  }

  // Immediate single-row write, for callers outside the buffered index loop
  // (realm copy fix-ups, tests). Runs the same guards + invalidation
  // bookkeeping the buffered path does, then writes without waiting for a
  // flush.
  async updateEntry(url: URL, entry: SearchIndexEntry): Promise<void> {
    if (this.#prerenderHtmlOnly) {
      throw new Error(
        `a prerenderHtmlOnly batch writes only the prerendered_html channel — use updatePrerenderedHtmlEntry`,
      );
    }
    if (!new RealmPaths(this.realmURL, this.virtualNetwork).inRealm(url)) {
      // TODO this is a workaround for CS-6886. after we have solved that issue we can
      // drop this band-aid
      return;
    }
    this.#assertErrorEntryHasMessage(url, entry);
    this.#invalidations.add(url.href);
    let start = Date.now();
    try {
      await this.#writeEntryNow(url, entry);
    } finally {
      this.#writeMs += Date.now() - start;
    }
  }

  // An instance-error / file-error entry whose `.error.message` is empty would
  // persist as a row with `has_error = true` and an error_doc that is null or
  // missing the human-readable text. Such a row is invisible to UI and DB-only
  // triage, and historically produced indexing jobs that re-reserved
  // indefinitely without ever rejecting. Throw at the boundary so the caller's
  // stderr log carries the underlying render error and the worker can finalize
  // the reservation against the per-job cap instead of silently writing a
  // black-hole row.
  #assertErrorEntryHasMessage(url: URL, entry: SearchIndexEntry): void {
    if (
      isErrorEntry(entry) &&
      (!entry.error ||
        typeof entry.error.message !== 'string' ||
        entry.error.message.length === 0)
    ) {
      throw new Error(
        `indexer refused ${entry.type} entry for ${url.href}: ` +
          `error.message is empty. An upstream entry-construction site dropped ` +
          `the underlying render error. Check worker stderr for the actual ` +
          `failure text.`,
      );
    }
  }

  // Physically write one prepared row. On the fused path the entry's HTML half
  // lands first: the boxel_index_working row is the resume marker
  // (`loadResumedRows` skips URLs it finds), so writing it last means a crash
  // between the two writes re-visits the URL rather than resuming a row whose
  // rendering never landed. (A split-mode batch writes no HTML — its spawned
  // `prerender_html` job owns that channel.)
  async #writeEntryNow(url: URL, entry: SearchIndexEntry): Promise<void> {
    let { preparedEntry, htmlEntry } = await this.#prepareIndexRow(url, entry);
    if (!this.#splitPrerenderHtml) {
      await this.writePrerenderedHtmlRow(url, htmlEntry);
    }
    let { nameExpressions, valueExpressions } = asExpressions(preparedEntry, {
      jsonFields: this.#jsonColumnNames(),
    });
    await this.#query([
      ...upsert(
        'boxel_index_working',
        'boxel_index_working_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  // Coalesce prepared rows into multi-row upserts. `asExpressions` derives the
  // column list from an object's keys, and one multi-row `VALUES` clause
  // requires every row to present the same columns in the same order — so
  // group by column signature and emit one upsert per group (success
  // instance/file rows fall in one group; error rows, which fold in the
  // last-known-good production columns, may each form their own).
  async #upsertIndexRows(rows: PreparedIndexRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    let jsonFields = this.#jsonColumnNames();
    let groups = new Map<string, PreparedIndexRow[]>();
    for (let row of rows) {
      let signature = Object.keys(row.preparedEntry).sort().join(',');
      let group = groups.get(signature);
      if (group) {
        group.push(row);
      } else {
        groups.set(signature, [row]);
      }
    }
    for (let group of groups.values()) {
      if (group.length === 1) {
        let { nameExpressions, valueExpressions } = asExpressions(
          group[0].preparedEntry,
          { jsonFields },
        );
        await this.#query([
          ...upsert(
            'boxel_index_working',
            'boxel_index_working_pkey',
            nameExpressions,
            valueExpressions,
          ),
        ]);
        continue;
      }
      // One stable column order shared by every row in the group, so each
      // row's values align with the single `nameExpressions` list.
      let columns = Object.keys(group[0].preparedEntry).sort();
      let nameExpressions = columns.map((column) => [column]);
      // Keep each INSERT within the adapter's bind-parameter ceiling: one
      // multi-row upsert binds `rows * columns` params, and SQLite caps that
      // (~999) — reachable when a batch flushes in split mode under SQLite
      // (forced in tests) — while Postgres tolerates far more. Chunk the group
      // so the statement stays under the limit, mirroring the per-adapter
      // chunking in `getDependencyRows`.
      let bindBudget = this.#dbAdapter.kind === 'sqlite' ? 900 : 60000;
      let rowsPerUpsert = Math.max(1, Math.floor(bindBudget / columns.length));
      for (let i = 0; i < group.length; i += rowsPerUpsert) {
        let slice = group.slice(i, i + rowsPerUpsert);
        let valueExpressions = slice.map(
          (row) =>
            asExpressions(orderKeys(row.preparedEntry, columns), { jsonFields })
              .valueExpressions,
        );
        await this.#query([
          ...upsertMultipleRows(
            'boxel_index_working',
            'boxel_index_working_pkey',
            nameExpressions,
            valueExpressions,
          ),
        ]);
      }
    }
  }

  #jsonColumnNames(): string[] {
    return [...Object.entries(coerceTypes)]
      .filter(([, type]) => type === 'JSON')
      .map(([column]) => column);
  }

  // Build the sanitized `boxel_index_working` row payload — and the paired
  // `prerendered_html` entry the fused path writes — for an entry, without
  // performing the upsert.
  //
  // The per-row diagnostics blob is assembled here: render-side fields come
  // from the Prerenderer's `response.meta` (already flattened in
  // `visit-file.ts`); the write-side `invalidationId` (minted once per Batch,
  // so every row from the same pass shares a queryable correlation key) and
  // `indexedAt` are stamped now. The canonical storage is the `diagnostics`
  // column; for error rows the blob is ALSO mirrored onto
  // `error_doc.diagnostics` so the UI read path keeps working unchanged.
  // jsonb-illegal bytes are stripped once, over the whole row, by the
  // `sanitizeForJsonb` at the end.
  async #prepareIndexRow(
    url: URL,
    entry: SearchIndexEntry,
  ): Promise<PreparedIndexRow> {
    let href = url.href;
    let diagnostics: Diagnostics = {
      ...(entry.diagnostics ?? {}),
      invalidationId: this.#currentInvalidationId,
      indexedAt: Date.now(),
    };
    let errorEntry = isErrorEntry(entry)
      ? {
          ...entry,
          error: this.normalizeErrorDoc(
            {
              ...entry.error,
              // The SerializedError shape's `diagnostics` is
              // `Record<string, unknown>` by design (it tolerates
              // extra fields for derived / legacy payloads);
              // `Diagnostics` is structurally-compatible
              // but needs an explicit cast across the boundary.
              diagnostics: diagnostics as Record<string, unknown>,
            },
            url,
          ),
        }
      : undefined;
    let entryPayload;
    switch (entry.type) {
      case 'instance':
        entryPayload = {
          // TODO in followup PR we need to alter the SearchEntry type to use
          // a document instead of a resource
          type: 'instance',
          pristine_doc: entry.resource,
          search_doc: entry.searchData,
          icon_html: entry.iconHTML,
          deps: [...entry.deps],
          last_known_good_deps: [...entry.deps],
          types: entry.types,
          display_names: entry.displayNames,
          last_modified: entry.lastModified,
          resource_created_at: entry.resourceCreatedAt,
          error_doc: null,
          has_error: false,
          diagnostics: diagnostics,
        };
        break;
      case 'file':
        entryPayload = {
          type: 'file',
          deps: [...entry.deps],
          last_known_good_deps: [...entry.deps],
          pristine_doc: entry.resource ?? null,
          search_doc: entry.searchData ?? null,
          types: entry.types ?? null,
          display_names: entry.displayNames ?? null,
          icon_html: entry.iconHTML ?? null,
          last_modified: entry.lastModified,
          resource_created_at: entry.resourceCreatedAt,
          error_doc: null,
          has_error: false,
          diagnostics: diagnostics,
        };
        break;
      case 'instance-error':
      case 'file-error': {
        let production: Record<string, any> =
          (await this.getProductionVersion(url, baseTypeFromError(entry))) ??
          {};
        entryPayload = {
          types: entry.types,
          // favor the last known good types over the types derived from the error state
          ...production,
          // Assign search_doc AFTER the production spread so the freshly-stamped
          // synthetic keys (`_title`, `_isCardInstanceFile`, `_cardType`) survive
          // rather than being clobbered by the last-known-good doc. Overlaying
          // the current searchData onto that doc keeps an instance's rich fields
          // when it degrades to a sparse error searchData, while a file /
          // dependency-error row (full searchData) wins outright.
          search_doc: entry.searchData
            ? { ...(production.search_doc ?? {}), ...entry.searchData }
            : (production.search_doc ?? null),
          // preserve last_known_good_deps through error cycles (may have been cleared
          // by getProductionVersion if it returned undefined, so we explicitly preserve it)
          last_known_good_deps: await this.getLastKnownGoodDeps(
            url,
            baseTypeFromError(entry),
          ),
          type: baseTypeFromError(entry),
          error_doc: errorEntry?.error ?? entry.error,
          has_error: true,
          diagnostics: diagnostics,
        };
        break;
      }
      default:
        throw new Error(
          `Unsupported index entry type: ${(entry as { type: string }).type}`,
        );
    }
    let preparedEntry = {
      url: href,
      file_alias: trimExecutableExtension(rri(url.href)).replace(/\.json$/, ''),
      generation: this.generation,
      realm_url: this.realmURL.href,
      is_deleted: false,
      indexed_at: Date.now(),
      job_id: this.jobInfo?.jobId ?? null,
      ...entryPayload,
    } as Omit<BoxelIndexTable, 'last_modified' | 'indexed_at'> & {
      // we do this because pg automatically casts big ints into strings, so
      // we unwind that to accurately type the structure that we want to pass
      // _in_ to the DB
      last_modified: number;
      indexed_at: number;
    };

    if (isErrorEntry(entry)) {
      // merge the last known good deps with the error deps so we can invalidate
      // when upstream issue is repaired
      preparedEntry.deps = [
        ...new Set([
          ...(preparedEntry.deps ?? []),
          ...(errorEntry?.error.deps ?? []),
        ]),
      ];
    }

    // Canonicalize dependency URLs to their portable RRI prefix form (e.g.
    // `@cardstack/base/foo`) before persisting. Index paths arrive here with
    // base deps in mixed forms: the instance render path already unresolves to
    // the prefix form, but the file-extract path records the virtual-alias URL
    // form. Normalizing here keeps one canonical form on disk; dependency
    // invalidation already searches both the real and prefix forms.
    if (preparedEntry.deps) {
      preparedEntry.deps = this.virtualNetwork.unresolveURLs(
        preparedEntry.deps,
      );
    }
    if (preparedEntry.last_known_good_deps) {
      preparedEntry.last_known_good_deps = this.virtualNetwork.unresolveURLs(
        preparedEntry.last_known_good_deps,
      );
    }

    // Strip jsonb-illegal code points from the entire row before persisting.
    // Postgres rejects the NUL character and unpaired UTF-16 surrogate halves
    // inside a jsonb value's text (22P05); a single such code point anywhere in
    // the row aborts the whole upsert batch and, during a from-scratch index,
    // strands every other card in the realm behind it. Sanitizing the prepared
    // row here — rather than per-field — covers every content column
    // (pristine_doc, search_doc, markdown, the *_html columns, deps,
    // display_names, diagnostics, error_doc) in one place, including rendered
    // card content that can carry a split emoji surrogate or a stray NUL folded
    // in from an upstream resolver.
    return {
      preparedEntry: sanitizeForJsonb(preparedEntry) as Record<string, unknown>,
      htmlEntry: prerenderedHtmlEntryFrom(entry, diagnostics),
    };
  }

  // Seed a prerenderHtmlOnly batch's invalidation set from the changes the
  // spawning index pass computed — the dependency fan-out already ran there
  // and is not recomputed here — and tombstone the whole set up front in
  // `prerendered_html_working` (the `prerendered_html` analog of
  // `tombstoneEntries`). The visit loop then overwrites survivors, exactly
  // as the index visit loop does on its channel: an `'update'` URL whose
  // render succeeds lands a fresh HTML row, a render failure lands an error
  // row, and a URL that is never overwritten — a `'delete'` operation, or an
  // `'update'` whose file turns out to be unreadable — stays tombstoned
  // through the swap.
  async seedPrerenderedHtmlInvalidations(
    changes: PrerenderedHtmlChange[],
  ): Promise<void> {
    if (!this.#prerenderHtmlOnly) {
      throw new Error(
        `seedPrerenderedHtmlInvalidations is only valid on a prerenderHtmlOnly batch`,
      );
    }
    await this.ready;
    let urls = [...new Set(changes.map((change) => change.url))];
    for (let url of urls) {
      this.#invalidations.add(url);
    }
    // Mirror `tombstoneEntries`: don't tombstone over rows a previous
    // attempt of this same job already rendered — that would erase the
    // resumed progress.
    let toTombstone = urls.filter((url) => !this.#resumedRows.has(url));
    if (toTombstone.length === 0) {
      return;
    }
    await this.tombstonePrerenderedHtmlEntries(toTombstone);
  }

  // Upsert one rendered (or render-error) row into
  // `prerendered_html_working`. The prerenderHtmlOnly counterpart of
  // `updateEntry`: same in-realm guard, same refusal of message-less error
  // entries, same jsonb sanitization — but the payload is only the HTML
  // half, stamped with the batch's carried generation. An error entry
  // preserves the last-known-good HTML from production `prerendered_html`
  // (an error row's HTML columns already carry the last-known-good rendering
  // from prior cycles, so any production row's HTML qualifies).
  async updatePrerenderedHtmlEntry(
    url: URL,
    entry: PrerenderedHtmlEntry | PrerenderedHtmlErrorEntry,
  ): Promise<void> {
    if (!this.#prerenderHtmlOnly) {
      throw new Error(
        `updatePrerenderedHtmlEntry is only valid on a prerenderHtmlOnly batch`,
      );
    }
    await this.writePrerenderedHtmlRow(url, entry);
  }

  // The prerendered_html row write shared by the two producers of renderings:
  // a `prerenderHtmlOnly` batch (via `updatePrerenderedHtmlEntry`) and a fused
  // batch (via `updateEntry`, which lands each visit's HTML half here inline).
  private async writePrerenderedHtmlRow(
    url: URL,
    entry: PrerenderedHtmlEntry | PrerenderedHtmlErrorEntry,
  ): Promise<void> {
    if (!new RealmPaths(this.realmURL, this.virtualNetwork).inRealm(url)) {
      return;
    }
    if (
      isErrorEntry(entry) &&
      (!entry.error ||
        typeof entry.error.message !== 'string' ||
        entry.error.message.length === 0)
    ) {
      throw new Error(
        `prerender-html writer refused ${entry.type} entry for ${url.href}: ` +
          `error.message is empty. An upstream entry-construction site dropped ` +
          `the underlying render error. Check worker stderr for the actual ` +
          `failure text.`,
      );
    }
    this.#invalidations.add(url.href);
    let payload: Record<string, unknown>;
    switch (entry.type) {
      case 'instance':
      case 'file': {
        let deps = this.virtualNetwork.unresolveURLs([...new Set(entry.deps)]);
        payload = {
          type: entry.type,
          fitted_html: entry.fittedHtml ?? null,
          embedded_html: entry.embeddedHtml ?? null,
          atom_html: entry.atomHtml ?? null,
          head_html: entry.headHtml ?? null,
          isolated_html: entry.isolatedHtml ?? null,
          markdown: entry.markdown ?? null,
          deps,
          last_known_good_deps: deps,
          error_doc: null,
          diagnostics: entry.diagnostics ?? null,
        };
        break;
      }
      case 'instance-error':
      case 'file-error': {
        let type = baseTypeFromError(entry);
        let production = await this.getPrerenderedHtmlProductionVersion(
          url,
          type,
        );
        // The column is the canonical home for the failing render's
        // diagnostics; the copy on `error_doc.diagnostics` mirrors the
        // `boxel_index` error-row pattern so error-doc consumers read one
        // shape on both channels. Unlike the HTML columns below, the
        // diagnostics are NOT taken from the last-known-good production
        // row — they describe this failing render.
        let errorDoc = this.normalizeErrorDoc(
          {
            ...entry.error,
            ...(entry.diagnostics
              ? {
                  diagnostics: entry.diagnostics as Record<string, unknown>,
                }
              : {}),
          },
          url,
        );
        payload = {
          type,
          fitted_html: production?.fitted_html ?? null,
          embedded_html: production?.embedded_html ?? null,
          atom_html: production?.atom_html ?? null,
          head_html: production?.head_html ?? null,
          isolated_html: production?.isolated_html ?? null,
          markdown: production?.markdown ?? null,
          // The failing render's own dependencies join the row's deps —
          // `itemsThatReference` scans this column, so fixing one of them
          // must fan out to this row and clear the error. Mirrors the
          // error-deps merge on the index channel's error path.
          deps: [
            ...new Set([...(production?.deps ?? []), ...(errorDoc.deps ?? [])]),
          ],
          last_known_good_deps: production?.last_known_good_deps ?? null,
          error_doc: errorDoc,
          diagnostics: entry.diagnostics ?? null,
        };
        break;
      }
      default:
        throw new Error(
          `Unsupported prerendered-html entry type: ${(entry as { type: string }).type}`,
        );
    }
    let preparedEntry = {
      url: url.href,
      file_alias: trimExecutableExtension(rri(url.href)).replace(/\.json$/, ''),
      realm_url: this.realmURL.href,
      generation: this.generation,
      is_deleted: false,
      rendered_at: Date.now(),
      job_id: this.jobInfo?.jobId ?? null,
      ...payload,
    };
    // Same write-boundary sanitization as `updateEntry`: a single
    // jsonb-illegal code point anywhere in the row would abort the upsert.
    let { nameExpressions, valueExpressions } = asExpressions(
      sanitizeForJsonb(preparedEntry),
      {
        jsonFields: [...Object.entries(coerceTypes)]
          .filter(([_, type]) => type === 'JSON')
          .map(([column]) => column),
      },
    );
    await this.#query([
      ...upsert(
        'prerendered_html_working',
        'prerendered_html_working_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  private async getPrerenderedHtmlProductionVersion(
    url: URL,
    expectedType: PrerenderedHtmlTable['type'],
  ): Promise<PrerenderedHtmlTable | undefined> {
    let [entry] = (await this.#query([
      `SELECT * FROM prerendered_html WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        any([
          [`url =`, param(url.href)],
          [`file_alias =`, param(url.href)],
        ]),
        ['type =', param(expectedType)],
      ]),
    ] as Expression)) as unknown as PrerenderedHtmlTable[];
    return entry;
  }

  private async existingPrerenderedHtmlTypes(
    invalidations: string[],
  ): Promise<Map<string, PrerenderedHtmlTable['type'][]>> {
    if (invalidations.length === 0) {
      return new Map();
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    let rows = (await this.#query([
      'SELECT DISTINCT url, type FROM prerendered_html WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(uniqueInvalidations.map((id) => [param(id)])),
          ),
        ],
      ]),
    ] as Expression)) as Pick<PrerenderedHtmlTable, 'url' | 'type'>[];
    let typesByUrl = new Map<string, PrerenderedHtmlTable['type'][]>();
    for (let row of rows) {
      let existing = typesByUrl.get(row.url);
      if (existing) {
        existing.push(row.type);
      } else {
        typesByUrl.set(row.url, [row.type]);
      }
    }
    return typesByUrl;
  }

  async done(): Promise<{ totalIndexEntries: number }> {
    // Drain any rows the visit loop left buffered before the swap reads the
    // working table. A no-op for a prerenderHtmlOnly batch (which never
    // buffers) and for a pass whose last write already forced a flush.
    await this.flushWriteBuffer();
    if (this.#prerenderHtmlOnly) {
      // A prerenderHtmlOnly batch touches nothing but the prerendered_html
      // channel: no realm_meta, no realm_generations bump, no boxel_index
      // swap. The guarded swap makes an out-of-order (lower-generation)
      // zombie job a per-row no-op.
      await this.#query(['BEGIN']);
      await this.promotePrerenderedHtmlWorking({ monotonicGuard: true });
      await this.#query(['COMMIT']);
      return { totalIndexEntries: this.#invalidations.size };
    }
    await this.#query(['BEGIN']);
    await this.updateRealmMeta();
    await this.applyBatchUpdates();
    await this.pruneObsoleteEntries();
    await this.#query(['COMMIT']);

    let totalIndexEntries = await this.numberOfIndexEntries();
    return { totalIndexEntries };
  }

  #query(expression: Expression) {
    return query(this.#dbAdapter, expression, coerceTypes);
  }

  private async getProductionVersion(
    url: URL,
    expectedType: BoxelIndexTable['type'],
  ) {
    let [entry] = (await this.#query([
      `SELECT i.*`,
      `FROM boxel_index as i
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param(expectedType)],
        any([['i.has_error = FALSE'], ['i.has_error IS NULL']]),
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    if (!entry) {
      return undefined;
    }

    let {
      indexed_at: _remove1,
      last_modified: _remove2,
      resource_created_at: _remove3,
      generation: _remove4,
      job_id: _remove5,
      ...productionVersion
    } = entry;
    return {
      ...productionVersion,
      last_modified: entry.last_modified ? parseInt(entry.last_modified) : null,
      resource_created_at: entry.resource_created_at
        ? parseInt(entry.resource_created_at)
        : null,
    };
  }

  private async getLastKnownGoodDeps(
    url: URL,
    expectedType: BoxelIndexTable['type'],
  ): Promise<string[] | null> {
    let [entry] = (await this.#query([
      `SELECT i.last_known_good_deps FROM boxel_index as i WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param(expectedType)],
        ['i.last_known_good_deps IS NOT NULL'],
      ]),
    ] as Expression)) as Pick<BoxelIndexTable, 'last_known_good_deps'>[];
    return entry?.last_known_good_deps ?? null;
  }

  private async numberOfIndexEntries() {
    let [{ total }] = (await this.#query([
      `SELECT count(i.url) as total
       FROM boxel_index as i
          WHERE`,
      ...every([
        ['i.realm_url =', param(this.realmURL.href)],
        any([['i.has_error = FALSE'], ['i.has_error IS NULL']]),
        ['i.is_deleted != true'],
      ]),
    ] as Expression)) as { total: string }[];
    return parseInt(total);
  }

  private async updateRealmMeta() {
    let instances = await this.#fetchTypeSummary('instance');
    let files = await this.#fetchTypeSummary('file');

    let value = { instances, files };

    let { nameExpressions, valueExpressions } = asExpressions(
      {
        realm_url: this.realmURL.href,
        generation: this.generation,
        value,
        indexed_at: unixTime(new Date().getTime()),
      } as Omit<RealmMetaTable, 'indexed_at'> & {
        indexed_at: number;
      },
      {
        jsonFields: ['value'],
      },
    );

    await this.#query([
      ...upsert(
        'realm_meta',
        'realm_meta_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  // Aggregates per-type summaries (count, display name, code-ref key, icon)
  // for one kind of row in boxel_index_working — either CardDef instances or
  // FileDef files. The shape of the result rows matches `CardTypeSummary`
  // exactly, so callers can drop them straight into `realm_meta.value`.
  //
  // Grouping is by `code_ref` only (not also by display_name). Display name
  // is aggregated with `MAX(...)`, which skips NULLs — so if some rows for
  // a given code_ref carry a populated display_name (extracted by the
  // current FileDefAttributesExtractor) and others carry an empty
  // `display_names` array (extracted by older indexer code that hadn't
  // shipped Step 2 yet), the rollup still produces a single summary row
  // with the non-null label. Without this, CardsGrid's sidebar shows two
  // entries for the same type — one labeled "Markdown", one labeled
  // "MarkdownDef" (the CodeRef-name fallback) — that resolve to identical
  // searches and confuse users during the transition window.
  async #fetchTypeSummary(
    indexType: BoxelIndexTable['type'],
  ): Promise<CardTypeSummary[]> {
    let results = await this.#query([
      `SELECT CAST(count(DISTINCT i.url) AS INTEGER) as total, MAX(i.display_names->>0) as display_name, i.types->>0 as code_ref, MAX(i.icon_html) as icon_html
       FROM boxel_index_working as i
          WHERE`,
      ...every([
        ['i.realm_url =', param(this.realmURL.href)],
        ['i.type = ', param(indexType)],
        ['i.types IS NOT NULL'],
        [
          dbExpression({
            pg: `(i.types->>0) IS NOT NULL`,
            sqlite: `json_extract(i.types, '$[0]') IS NOT NULL`,
          }),
        ],
        any([['i.is_deleted = false'], ['i.is_deleted IS NULL']]),
      ]),
      `GROUP BY i.types->>0`,
      `ORDER BY MAX(i.display_names->>0) ASC NULLS LAST`,
    ] as Expression);
    return results as unknown as CardTypeSummary[];
  }

  private async applyBatchUpdates() {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: this.realmURL.href,
      current_generation: this.generation,
      loader_epoch: this.loaderEpoch,
    } as RealmGenerationsTable);
    await this.#query([
      ...upsert(
        'realm_generations',
        'realm_generations_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);

    if (this.#invalidations.size > 0) {
      let columns = (await this.#dbAdapter.getColumnNames('boxel_index')).map(
        (c) => [c],
      );
      let names = flattenDeep(columns);
      await this.#query([
        'INSERT INTO boxel_index',
        ...addExplicitParens(separatedByCommas(columns)),
        'SELECT',
        ...separatedByCommas(columns),
        'FROM boxel_index_working',
        'WHERE',
        ...every([
          ['realm_url =', param(this.realmURL.href)],
          [
            'url in',
            ...addExplicitParens(
              separatedByCommas(
                [...this.#invalidations].map((i) => [param(i)]),
              ),
            ),
          ],
        ]),
        'ON CONFLICT ON CONSTRAINT boxel_index_pkey DO UPDATE SET',
        ...separatedByCommas(names.map((name) => [`${name}=EXCLUDED.${name}`])),
      ] as Expression);

      // Publish this pass's `prerendered_html_working` rows, UNLESS this is a
      // split-mode index pass — in which case HTML flows only through the
      // `prerender_html` job, this pass wrote nothing to the channel, and the
      // job's own swap publishes it. The fused path (SQLite) lands each
      // visit's HTML half in `prerendered_html_working` via `updateEntry`
      // (tombstones via `tombstoneEntries`); a copy fills the channel from
      // the source realm's rows below.
      if (!this.#splitPrerenderHtml || this.#copyFromSourceRealm) {
        // For a copy, overlay the source realm's `prerendered_html` rows onto
        // the destination's working table. A destination URL whose source has
        // no `prerendered_html` row gets none either — it reads as unrendered
        // and the catch-up sweep enqueues its render.
        if (this.#copyFromSourceRealm) {
          await this.copyPrerenderedHtmlFrom(this.#copyFromSourceRealm);
        }

        // Swap the working HTML rows into production in the same
        // transaction, keyed by the same invalidation set and generation.
        await this.promotePrerenderedHtmlWorking();
      }
    }
  }

  // Swap `prerendered_html_working` rows into production `prerendered_html`,
  // keyed by this batch's invalidation set. `prerendered_html` has no
  // `job_id` column, so getColumnNames yields the production projection and
  // the SELECT drops `job_id` from prerendered_html_working.
  //
  // A prerenderHtmlOnly batch passes `monotonicGuard: true`: the trailing
  // `WHERE prerendered_html.generation <= EXCLUDED.generation` makes a stale
  // (lower-generation) write a per-row no-op — the backstop against an
  // expired-reservation zombie job overwriting a newer pass's rows — while
  // keeping an equal-generation retry idempotent. Index/copy batches swap
  // unguarded, exactly as before the split: their generation is freshly
  // bumped, so the guard would always pass anyway.
  private async promotePrerenderedHtmlWorking(opts?: {
    monotonicGuard?: boolean;
  }): Promise<void> {
    if (this.#invalidations.size === 0) {
      return;
    }
    let prerenderedColumns = (
      await this.#dbAdapter.getColumnNames('prerendered_html')
    ).map((c) => [c]);
    let prerenderedNames = flattenDeep(prerenderedColumns);
    await this.#query([
      'INSERT INTO prerendered_html',
      ...addExplicitParens(separatedByCommas(prerenderedColumns)),
      'SELECT',
      ...separatedByCommas(prerenderedColumns),
      'FROM prerendered_html_working',
      'WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url in',
          ...addExplicitParens(
            separatedByCommas([...this.#invalidations].map((i) => [param(i)])),
          ),
        ],
      ]),
      'ON CONFLICT ON CONSTRAINT prerendered_html_pkey DO UPDATE SET',
      ...separatedByCommas(
        prerenderedNames.map((name) => [`${name}=EXCLUDED.${name}`]),
      ),
      ...(opts?.monotonicGuard
        ? ['WHERE prerendered_html.generation <= EXCLUDED.generation']
        : []),
    ] as Expression);
  }

  private async pruneObsoleteEntries() {
    // Delete every realm_meta row for this realm except the one we just
    // wrote. The previous predicate (`generation < this.generation`)
    // only swept rows from incremental indexing where generations march
    // forward. A from-scratch reindex resets the generation to a low number,
    // leaving older high-generation rows orphaned forever — those legacy rows
    // then poisoned `_types` reads when the SELECT picked the wrong one.
    // Cleaning by `!=` covers both directions safely; the unique key on
    // (realm_url, generation) guarantees we never accidentally keep
    // two current rows.
    await this.#query([
      `DELETE FROM realm_meta`,
      'WHERE',
      ...every([
        ['generation !=', param(this.generation)],
        ['realm_url =', param(this.realmURL.href)],
      ]),
    ] as Expression);
  }

  private async setNextGeneration() {
    let [row] = (await this.#query([
      'SELECT current_generation, loader_epoch FROM realm_generations WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmGenerationsTable, 'current_generation' | 'loader_epoch'>[];
    this.#priorLoaderEpoch = row?.loader_epoch ?? '0';
    if (!row) {
      let { nameExpressions, valueExpressions } = asExpressions({
        realm_url: this.realmURL.href,
        current_generation: 0,
        loader_epoch: '0',
      } as RealmGenerationsTable);
      // Make the batch updates live
      await this.#query([
        ...upsert(
          'realm_generations',
          'realm_generations_pkey',
          nameExpressions,
          valueExpressions,
        ),
      ]);
      this.generation = 1;
    } else {
      this.generation = row.current_generation + 1;
    }
  }

  private async tombstoneEntries(invalidations: string[]) {
    // insert tombstone into next version of the realm index. Stamp
    // the current `invalidationId` + `indexedAt` on every tombstone
    // so fan-out queries (`WHERE diagnostics->>'invalidationId'
    // = <id>`) also surface the delete rows for this pass — otherwise
    // tombstones would inherit a stale ID from a prior write or stay
    // NULL entirely, misattributing deletes in the grouping view.
    //
    // Filter out URLs the previous attempt of this job already wrote
    // a real (non-tombstone) row for. Tombstoning would upsert over
    // that real content and erase the previous attempt's progress,
    // defeating the resume.
    let toTombstone = invalidations.filter(
      (url) => !this.#resumedRows.has(url),
    );
    if (toTombstone.length === 0) {
      return;
    }
    let existingTypes = await this.existingIndexTypes(toTombstone);
    for (let [url, entries] of existingTypes) {
      let liveTypes = entries
        .filter((entry) => !entry.isDeleted)
        .map((entry) => entry.type);
      if (liveTypes.length > 0) {
        this.#tombstonedLiveTypes.set(url, liveTypes);
      }
    }
    // `has_error` and `error_doc` are listed (with explicit false / null
    // values per row) so the upsert's ON CONFLICT SET clause clears them.
    // The primary key is `(url, realm_url, type)` — no `generation` —
    // so a tombstone always collides with the prior row, and any column
    // NOT in this list keeps its previous value. Without these two,
    // a row that ever held `has_error = true` would carry that flag
    // (and whatever `error_doc` it had at the time, including
    // `jsonb null`) through every subsequent reindex, producing a row
    // that reads as "errored but with no message" indefinitely.
    let columns = [
      'url',
      'file_alias',
      'type',
      'generation',
      'realm_url',
      'is_deleted',
      'has_error',
      'error_doc',
      'diagnostics',
      'job_id',
    ].map((c) => [c]);
    let tombstoneDiagnostics: Diagnostics = {
      invalidationId: this.#currentInvalidationId,
      indexedAt: Date.now(),
    };
    // `diagnostics` is a jsonb column. This helper uses
    // `upsertMultipleRows` which passes each value through `param()`
    // as a raw `PgPrimitive`, so we pre-serialize the JSON here (the
    // regular `updateEntry` path reaches jsonb via `asExpressions`
    // with a `jsonFields` list, which does the same thing).
    let tombstoneDiagnosticsJson = JSON.stringify(tombstoneDiagnostics);
    let jobIdValue = this.jobInfo?.jobId ?? null;
    let rows = toTombstone.flatMap((id) => {
      let types = existingTypes.get(id);
      if (!types || types.length === 0) {
        return [];
      }
      return types.map(({ type }) =>
        [
          id,
          // The same file_alias form `updateEntry` writes, so a tombstone
          // upsert doesn't swap the row's alias to a `.json`-suffixed
          // variant that alias-keyed lookups (`urlsMatchingSeed*`) miss.
          trimExecutableExtension(rri(id)).replace(/\.json$/, ''),
          type,
          this.generation,
          this.realmURL.href,
          true, // is_deleted
          false, // has_error — explicit clear so stale error state from
          // a prior pass does not survive the deletion
          null, // error_doc — same rationale
          tombstoneDiagnosticsJson,
          jobIdValue,
        ].map((v) => [param(v)]),
      );
    });

    if (rows.length === 0) {
      return;
    }

    await this.#query([
      ...upsertMultipleRows(
        'boxel_index_working',
        'boxel_index_working_pkey',
        columns,
        rows,
      ),
    ]);

    // On the fused path this batch owns the prerendered_html channel too, so
    // the deletion must tombstone both. (A split-mode batch leaves the
    // channel to its spawned `prerender_html` job, whose
    // `seedPrerenderedHtmlInvalidations` tombstones it.)
    if (!this.#splitPrerenderHtml) {
      await this.tombstonePrerenderedHtmlEntries(toTombstone);
    }
  }

  // Tombstone the prerendered_html channel for the given URLs — the
  // `prerendered_html_working` analog of `tombstoneEntries`, written by a
  // prerenderHtmlOnly batch's seeding and by a fused batch alongside its
  // boxel_index tombstones. Only URLs with existing prerendered_html rows
  // get one (there is no rendering to hide otherwise), and the tombstone
  // clears any prior render error / diagnostics. The visit loop's writes
  // overwrite survivors, so only genuinely deleted URLs stay tombstoned
  // through the swap.
  private async tombstonePrerenderedHtmlEntries(urls: string[]): Promise<void> {
    let existingTypes = await this.existingPrerenderedHtmlTypes(urls);
    let columns = [
      'url',
      'file_alias',
      'type',
      'generation',
      'realm_url',
      'is_deleted',
      'error_doc',
      'diagnostics',
      'rendered_at',
      'job_id',
    ].map((c) => [c]);
    let now = Date.now();
    let jobIdValue = this.jobInfo?.jobId ?? null;
    let rows = urls.flatMap((id) => {
      let types = existingTypes.get(id);
      if (!types || types.length === 0) {
        return [];
      }
      return types.map((type) =>
        [
          id,
          // The same file_alias form the live prerendered_html writes use, so
          // alias-keyed consumers (e.g. the itemsThatReference deps scan) see
          // one alias per URL whether the row is live or tombstoned.
          trimExecutableExtension(rri(id)).replace(/\.json$/, ''),
          type,
          this.generation,
          this.realmURL.href,
          true, // is_deleted
          null, // error_doc — a tombstone clears any prior render error
          null, // diagnostics — likewise cleared; they described the render this tombstone hides
          now,
          jobIdValue,
        ].map((v) => [param(v)]),
      );
    });
    if (rows.length === 0) {
      return;
    }
    await this.#query([
      ...upsertMultipleRows(
        'prerendered_html_working',
        'prerendered_html_working_pkey',
        columns,
        rows,
      ),
    ]);
  }

  private async existingIndexTypes(
    invalidations: string[],
  ): Promise<
    Map<string, { type: BoxelIndexTable['type']; isDeleted: boolean }[]>
  > {
    if (invalidations.length === 0) {
      return new Map();
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    // One row per (url, type) — the table's primary key is
    // (url, realm_url, type) and the realm is pinned below.
    let rows = (await this.#query([
      'SELECT url, type, is_deleted FROM boxel_index WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(uniqueInvalidations.map((id) => [param(id)])),
          ),
        ],
      ]),
    ] as Expression)) as Pick<BoxelIndexTable, 'url' | 'type' | 'is_deleted'>[];
    let typesByUrl = new Map<
      string,
      { type: BoxelIndexTable['type']; isDeleted: boolean }[]
    >();
    for (let row of rows) {
      let entry = { type: row.type, isDeleted: Boolean(row.is_deleted) };
      let existing = typesByUrl.get(row.url);
      if (existing) {
        existing.push(entry);
      } else {
        typesByUrl.set(row.url, [entry]);
      }
    }
    return typesByUrl;
  }

  private async urlsMatchingSeedFromCurrentBatch(
    seedURL: URL,
  ): Promise<string[]> {
    let rows = (await this.#query([
      `SELECT DISTINCT url FROM boxel_index_working WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['generation =', param(this.generation)],
        any([
          ['url =', param(seedURL.href)],
          ['file_alias =', param(seedURL.href)],
        ]),
      ]),
    ] as Expression)) as Pick<BoxelIndexTable, 'url'>[];

    return rows.map(({ url }) => url);
  }

  private async urlsMatchingSeedFromProduction(
    seedURL: URL,
  ): Promise<string[]> {
    let rows = (await this.#query([
      `SELECT DISTINCT url FROM boxel_index WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        any([
          ['url =', param(seedURL.href)],
          ['file_alias =', param(seedURL.href)],
        ]),
      ]),
    ] as Expression)) as Pick<BoxelIndexTable, 'url'>[];

    return rows.map(({ url }) => url);
  }

  private async urlsMatchingSeed(seedURL: URL): Promise<string[]> {
    let currentBatchMatches =
      await this.urlsMatchingSeedFromCurrentBatch(seedURL);
    if (currentBatchMatches.length > 0) {
      return currentBatchMatches;
    }

    return await this.urlsMatchingSeedFromProduction(seedURL);
  }

  private async invalidationSeeds(url: URL): Promise<string[]> {
    let matchedURLs = await this.urlsMatchingSeed(url);
    return [...new Set([url.href, ...matchedURLs])];
  }

  async invalidate(urls: URL[]): Promise<void> {
    if (this.#prerenderHtmlOnly) {
      // The dependency fan-out already ran once in the spawning index pass
      // and is threaded in as `changes` — seed it, don't recompute it.
      throw new Error(
        `a prerenderHtmlOnly batch does not compute invalidations — use seedPrerenderedHtmlInvalidations`,
      );
    }
    await this.ready;
    // Mint a fresh correlation ID for this invalidation fan-out; every
    // subsequent `updateEntry` on this batch stamps it into the row's
    // `diagnostics` so operators can group the rows touched by
    // the same triggering change.
    this.#currentInvalidationId = uuidv4();
    let start = Date.now();
    this.#perfLog.debug(
      `${jobIdentity} starting invalidation of ${urls.map((u) => u.href).join()}`,
    );
    let visited = new Set<string>();
    let invalidations: string[] = [];
    for (let url of urls) {
      for (let seed of await this.invalidationSeeds(url)) {
        let alias = trimExecutableExtension(rri(seed));
        let workingInvalidations = [
          ...new Set([
            ...(!this.nodeResolvedInvalidations.includes(alias) ? [seed] : []),
            ...(alias ? await this.calculateInvalidations(alias, visited) : []),
          ]),
        ];
        invalidations = [
          ...new Set([...invalidations, ...workingInvalidations]),
        ];
      }
    }

    if (invalidations.length === 0) {
      return;
    }

    let insertStart = Date.now();
    await this.tombstoneEntries(invalidations);

    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} inserted invalidated rows for  ${urls.map((u) => u.href).join()} in ${
        Date.now() - insertStart
      } ms`,
    );

    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} completed invalidation of ${urls.map((u) => u.href).join()} in ${Date.now() - start} ms`,
    );

    this.#invalidations = new Set([...this.#invalidations, ...invalidations]);
  }

  // Returns the minimum projection (url, type, deps) needed to order
  // invalidations by dependency. Server-side selection picks one row per
  // (url, type) with priority: working-non-deleted > production > working-deleted,
  // applied via a window function over UNION ALL of both tables. Avoids the
  // double client-side merge and the dead-weight `error_doc` payload that
  // `getDependencyRows` carries for the error fan-out path.
  async getOrderingDependencyRows(
    urls: string[],
  ): Promise<Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>[]> {
    await this.ready;
    if (urls.length === 0) {
      return [];
    }

    let uniqueUrls = [...new Set(urls)];
    // SQLite has a lower parameter limit than Postgres. Each batch binds
    // `realm_url` and the URL list once per source table, so the per-batch
    // param count is roughly 2 * (urlBatchSize + 1). Keep the per-call total
    // within safe bounds for both adapters.
    let urlBatchSize = this.#dbAdapter.kind === 'sqlite' ? 450 : 2500;
    let selected: Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>[] = [];
    for (let i = 0; i < uniqueUrls.length; i += urlBatchSize) {
      let urlBatch = uniqueUrls.slice(i, i + urlBatchSize);
      let batchRows = await this.queryOrderingDependencyRows(urlBatch);
      selected.push(...batchRows);
    }
    return selected;
  }

  private async queryOrderingDependencyRows(
    urls: string[],
  ): Promise<Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>[]> {
    if (urls.length === 0) {
      return [];
    }
    let rows = (await this.#query([
      'SELECT url, type, deps FROM (',
      'SELECT url, type, deps,',
      'ROW_NUMBER() OVER (PARTITION BY url, type ORDER BY source_priority) AS rn',
      'FROM (',
      'SELECT url, type, deps,',
      'CASE WHEN is_deleted THEN 2 ELSE 0 END AS source_priority',
      'FROM boxel_index_working WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(urls.map((url) => [param(url)])),
          ),
        ],
        any([
          ['type =', param('instance')],
          ['type =', param('file')],
        ]),
      ]),
      'UNION ALL',
      'SELECT url, type, deps, 1 AS source_priority',
      'FROM boxel_index WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(urls.map((url) => [param(url)])),
          ),
        ],
        any([
          ['type =', param('instance')],
          ['type =', param('file')],
        ]),
      ]),
      ') candidates',
      ') ranked',
      'WHERE rn = 1',
    ] as Expression)) as Pick<BoxelIndexTable, 'url' | 'type' | 'deps'>[];

    return rows.map((row) => ({
      url: row.url,
      type: row.type,
      deps: row.deps ?? null,
    }));
  }

  async getDependencyRows(urls: string[]): Promise<DependencyIndexRow[]> {
    await this.ready;
    if (urls.length === 0) {
      return [];
    }

    let uniqueUrls = [...new Set(urls)];
    // Dependency-error bookkeeping is the only mid-pass reader of this pass's
    // own writes. Flush the write-behind buffer when this query would touch a
    // still-buffered URL so the dependent sees the dependency's row. The check
    // matches on the same URL strings the SQL below binds into `url IN (...)`,
    // so it flushes exactly when the query could otherwise miss a held row —
    // and skips the flush (preserving batching) when it wouldn't.
    if (
      this.#writeBuffer.length > 0 &&
      uniqueUrls.some((url) => this.#writeBufferUrls.has(url))
    ) {
      await this.flushWriteBuffer();
    }
    // SQLite has a lower parameter limit than Postgres. Chunk URL lookups to
    // keep IN-clause parameter counts within safe bounds for both adapters.
    let urlBatchSize = this.#dbAdapter.kind === 'sqlite' ? 900 : 5000;
    let workingRows: DependencyIndexRow[] = [];
    let productionRows: DependencyIndexRow[] = [];
    for (let i = 0; i < uniqueUrls.length; i += urlBatchSize) {
      let urlBatch = uniqueUrls.slice(i, i + urlBatchSize);
      let [workingBatchRows, productionBatchRows] = await Promise.all([
        this.queryDependencyRows('boxel_index_working', urlBatch),
        this.queryDependencyRows('boxel_index', urlBatch),
      ]);
      workingRows.push(...workingBatchRows);
      productionRows.push(...productionBatchRows);
    }

    let rowsByKey = new Map<
      string,
      {
        working?: DependencyIndexRow;
        production?: DependencyIndexRow;
      }
    >();

    for (let row of workingRows) {
      let key = `${row.url}|${row.type}`;
      let existing = rowsByKey.get(key) ?? {};
      existing.working = row;
      rowsByKey.set(key, existing);
    }

    for (let row of productionRows) {
      let key = `${row.url}|${row.type}`;
      let existing = rowsByKey.get(key) ?? {};
      existing.production = row;
      rowsByKey.set(key, existing);
    }

    let selectedRows: DependencyIndexRow[] = [];
    for (let { working, production } of rowsByKey.values()) {
      if (working && !working.isDeleted) {
        selectedRows.push(working);
        continue;
      }
      if (working?.isDeleted && production) {
        selectedRows.push(production);
        continue;
      }
      if (working) {
        selectedRows.push(working);
        continue;
      }
      if (production) {
        selectedRows.push(production);
      }
    }

    return selectedRows;
  }

  private async queryDependencyRows(
    tableName: 'boxel_index' | 'boxel_index_working',
    urls: string[],
  ): Promise<DependencyIndexRow[]> {
    if (urls.length === 0) {
      return [];
    }

    let rows = (await this.#query([
      `SELECT url, type, deps, has_error, is_deleted, error_doc FROM ${tableName} WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(urls.map((url) => [param(url)])),
          ),
        ],
        any([
          ['type =', param('instance')],
          ['type =', param('file')],
        ]),
      ]),
    ] as Expression)) as Pick<
      BoxelIndexTable,
      'url' | 'type' | 'deps' | 'has_error' | 'is_deleted' | 'error_doc'
    >[];

    return rows.map((row) => ({
      url: row.url,
      type: row.type,
      deps: row.deps ?? null,
      hasError: Boolean(row.has_error),
      isDeleted: Boolean(row.is_deleted),
      errorDoc: row.error_doc ?? null,
    }));
  }

  private async itemsThatReference(resolvedPath: string): Promise<
    {
      url: string;
      alias: string | null;
      type: BoxelIndexTable['type'];
    }[]
  > {
    let start = Date.now();
    const pageSize = 1000;
    // Also search for the prefix form of the path (e.g. @cardstack/catalog/...)
    // since deps may be stored in prefix form for portability
    let unresolvedPath = this.unresolveURL(resolvedPath);
    let searchBothForms =
      unresolvedPath !== resolvedPath &&
      this.isRegisteredPrefix(unresolvedPath);
    let scanTable = async (
      tableName: 'boxel_index_working' | 'prerendered_html',
    ) => {
      let results: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
        type: BoxelIndexTable['type'];
      })[] = [];
      let rows: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
        type: BoxelIndexTable['type'];
      })[] = [];
      let pageNumber = 0;
      do {
        // SQLite does not support cursors when used in the worker thread since
        // the API for using cursors cannot be serialized over the postMessage
        // boundary. so we use a handcrafted paging approach
        let depCondition: Expression = searchBothForms
          ? (any([
              [
                dbExpression({
                  sqlite: `deps_array_element =`,
                  pg: `i.deps @>`,
                }),
                param({
                  sqlite: resolvedPath,
                  pg: `["${resolvedPath}"]`,
                }),
              ],
              [
                dbExpression({
                  sqlite: `deps_array_element =`,
                  pg: `i.deps @>`,
                }),
                param({
                  sqlite: unresolvedPath,
                  pg: `["${unresolvedPath}"]`,
                }),
              ],
            ]) as Expression)
          : ([
              dbExpression({
                sqlite: `deps_array_element =`,
                pg: `i.deps @>`,
              }),
              param({ sqlite: resolvedPath, pg: `["${resolvedPath}"]` }),
            ] as Expression);
        rows = (await this.#query([
          'SELECT i.url, i.file_alias, i.type',
          `FROM ${tableName} as i`,
          dbExpression({
            sqlite:
              'CROSS JOIN LATERAL jsonb_array_elements_text(i.deps) as deps_array_element',
          }),
          'WHERE',
          ...every([
            depCondition,
            // probably need to reevaluate this condition when we get to cross
            // realm invalidation
            [`i.realm_url =`, param(this.realmURL.href)],
          ]),
          `LIMIT ${pageSize} OFFSET ${pageNumber * pageSize}`,
        ] as Expression)) as (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
          type: BoxelIndexTable['type'];
        })[];
        results = [...results, ...rows];
        pageNumber++;
      } while (rows.length === pageSize);
      return { results, pageNumber };
    };
    // The reference graph spans both channels: `boxel_index_working.deps`
    // carries the index visit's edges (the search-doc walk), while
    // `prerendered_html.deps` carries edges only the format renders discover
    // — a rendered non-searchable link, the scoped-CSS artifacts of linked
    // instances. Both edge sets must feed the fan-out or a change to a
    // render-only dependency would never re-render its consumers.
    let [workingScan, prerenderedScan] = await Promise.all([
      scanTable('boxel_index_working'),
      scanTable('prerendered_html'),
    ]);
    let seen = new Set<string>();
    let results: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
      type: BoxelIndexTable['type'];
    })[] = [];
    for (let row of [...workingScan.results, ...prerenderedScan.results]) {
      let key = `${row.url}|${row.type}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(row);
    }
    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} time to determine items that reference ${resolvedPath} ${
        Date.now() - start
      } ms (page count=${workingScan.pageNumber + prerenderedScan.pageNumber})`,
    );
    return results.map(({ url, file_alias, type }) => ({
      url,
      alias: file_alias,
      type,
    }));
  }

  private async calculateInvalidations(
    resolvedPath: string,
    visited: Set<string>,
  ): Promise<string[]> {
    if (
      visited.has(resolvedPath) ||
      this.nodeResolvedInvalidations.includes(rri(resolvedPath))
    ) {
      return [];
    }
    visited.add(resolvedPath);
    let items = await this.itemsThatReference(resolvedPath);
    let invalidations = items.map(({ url }) => url);
    let aliases = items.map(({ alias, type, url }) =>
      this.invalidationTraversalAlias({ alias, type, url }),
    );
    let results = [
      ...invalidations,
      ...flatten(
        await Promise.all(
          aliases
            .filter((a): a is string => Boolean(a))
            .map((a) => this.calculateInvalidations(a, visited)),
        ),
      ),
    ];
    return [...new Set(results)];
  }

  private invalidationTraversalAlias({
    alias,
    type,
    url,
  }: {
    alias: string | null;
    type: BoxelIndexTable['type'];
    url: string;
  }): string {
    if (type === 'instance') {
      // for instances we expect that deps include concrete .json URLs
      return url;
    }
    if (hasExecutableExtension(url) && alias) {
      // executable file invalidation needs node-style alias traversal
      return alias;
    }
    // non-executable files should recurse by concrete URL
    return url;
  }

  private copiedRealmURL(fromRealm: URL, file: URL): URL {
    let source = new RealmPaths(fromRealm, this.virtualNetwork);
    let dest = new RealmPaths(this.realmURL, this.virtualNetwork);
    if (!source.inRealm(file)) {
      return file;
    }
    let local = source.local(file);
    return dest.fileURL(local);
  }

  private objectWithCopiedRealmKeys(
    fromRealm: URL,
    obj: Record<string, any>,
  ): Record<string, any> {
    let result: Record<string, any> = {};
    for (let [key, value] of Object.entries(obj)) {
      result[this.copiedRealmURL(fromRealm, new URL(key)).href] = value;
    }
    return result;
  }

  private normalizeErrorDoc(
    error: SerializedError,
    entryURL: URL,
    depMapper?: (dep: URL) => URL,
  ): SerializedError {
    let deps = error.deps
      ? [
          ...new Set(
            error.deps.map((dep) =>
              this.normalizeDependency(dep, entryURL, depMapper),
            ),
          ),
        ]
      : undefined;
    // Clamp before persistence so a runaway `additionalErrors` tree
    // (or an oversized stack/message) can't trip Postgres's 256 MiB
    // jsonb-array container limit on upsert.
    return clampSerializedError({
      ...error,
      id: error.id ?? entryURL.href,
      ...(deps ? { deps } : {}),
    });
  }

  private normalizeDependency(
    dep: string,
    entryURL: URL,
    depMapper?: (dep: URL) => URL,
  ): string {
    try {
      let resolved = new URL(dep, entryURL);
      resolved.search = '';
      resolved.hash = '';
      resolved = depMapper ? depMapper(resolved) : resolved;
      return trimExecutableExtension(rri(resolved.href));
    } catch (_err) {
      return dep;
    }
  }

  private updateIds(obj: any, fromRealm: URL) {
    if (Array.isArray(obj)) {
      obj.forEach((i) => this.updateIds(i, fromRealm));
    } else if (obj && typeof obj === 'object') {
      for (let key in obj) {
        if (
          key === 'id' &&
          'id' in obj &&
          obj.id &&
          typeof obj.id === 'string'
        ) {
          obj.id = this.isRegisteredPrefix(obj.id)
            ? obj.id
            : this.copiedRealmURL(fromRealm, new URL(obj.id));
        } else {
          this.updateIds(obj[key], fromRealm);
        }
      }
    }
  }
}

function baseTypeFromError(entry: {
  type: 'instance-error' | 'file-error';
}): Extract<BoxelIndexTable['type'], 'instance' | 'file'> {
  switch (entry.type) {
    case 'instance-error':
      return 'instance';
    case 'file-error':
      return 'file';
  }
}

// The `boxel_index` row type an entry lands under — the pkey is
// (url, realm_url, type), so this keys the flush dedup that keeps a single
// multi-row upsert from touching one conflict target twice.
function rowType(entry: SearchIndexEntry): BoxelIndexTable['type'] {
  return isErrorEntry(entry) ? baseTypeFromError(entry) : entry.type;
}

// A `boxel_index_working` row payload built but not yet upserted, plus the
// paired `prerendered_html` entry the fused path writes for it.
interface PreparedIndexRow {
  preparedEntry: Record<string, unknown>;
  htmlEntry: PrerenderedHtmlEntry | PrerenderedHtmlErrorEntry;
}

// Return a copy of `obj` with its keys in `keys` order, so a batch of rows
// sharing the same key set serializes to value tuples aligned with one shared
// column list.
function orderKeys(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  let ordered: Record<string, unknown> = {};
  for (let key of keys) {
    ordered[key] = obj[key];
  }
  return ordered;
}
