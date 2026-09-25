import { flatten } from 'lodash-es';
import {
  type CardResource,
  type JobInfo,
  jobIdentity,
  trimExecutableExtension,
  hasExecutableExtension,
  passInvalidatesExecutables,
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
  type Querier,
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
import {
  screenshotLedgerSourceURL,
  type ScreenshotManifest,
} from './capture-spec.ts';
import type { RealmMetaTable } from './index-structure.ts';
import type { FileMetaResource } from './resource-types.ts';
import type { DeclaredScreenshotError, Diagnostics } from './index.ts';
import {
  ALL_TYPES_KEY,
  coerceTypes,
  isPartitionedRealmMetaValue,
  type BoxelIndexTable,
  type CardTypeSummary,
  type PrerenderedHtmlTable,
  type RealmGenerationsTable,
  type RealmIndexCommitsTable,
  type RealmMetaValue,
} from './index-structure.ts';
import { v4 as uuidv4 } from '@lukeed/uuid';
import { md5 } from 'super-fast-md5';
import {
  isScopedCSSRequest,
  isHashedScopedCSSRequest,
  parseScopedCSSRequest,
  encodeHashedScopedCSSRequest,
} from './scoped-css.ts';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  indexingConcurrencyGroup,
  systemInitiatedIndexPriority,
} from './jobs/indexing.ts';

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
  // The content hash of the stored source the render read to produce
  // `resource`, persisted to `boxel_index.source_content_hash` and served as
  // `meta.version` on the card+json GET.
  //
  // Reported by the render rather than computed here, because a client sends it
  // back as the base its next write is computed against and the realm answers
  // `baseMatched` from it. The worker's own read of the same file is a separate
  // `card+source` GET that can be answered by a different replica, so a hash
  // taken from there can describe bytes the document was not built from.
  //
  // Undefined when the render produced no fingerprint — an older prerenderer,
  // or a render that built no card document. The column is then null and the
  // GET reports no version, which is what it did before the column existed.
  sourceContentHash?: string;
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

// One prerendered_html row's declared-screenshot state, as
// `priorScreenshotStates` reads it back for the next pass over the same URL.
export interface PriorScreenshotState {
  manifest: ScreenshotManifest | null;
  screenshotErrors: DeclaredScreenshotError[] | null;
  captureFailureRenders: number | null;
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
  // The declared-screenshot manifest for this row — every slot the visit
  // captured or carried forward. Absent/null clears the column: the
  // manifest always reflects what THIS pass captured, never a stale one.
  screenshots?: ScreenshotManifest | null;
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

// Whether a single verdict array names the row type about to be written.
// Presence *and* membership: the mark names which of a visit's rows it applies
// to, so a card render that failed for the environment's reasons cannot
// withhold a file row that failed for its own.
//
// Absence means no verdict, never "attributable" — a response from anything
// that does not stamp this (a server predating the field, which a worker sees
// throughout a rolling deploy) must not read as licence to withhold a row.
function verdictArrayCoversRow(
  verdict: ('instance' | 'file')[] | undefined,
  type: 'instance' | 'file',
): boolean {
  return Array.isArray(verdict) && verdict.includes(type);
}

// Whether *any* of the prerender server's unattributability verdicts covers
// this row. The verdicts differ only in why the failure was the environment's
// — a stale host shell mid-deploy, or a gateway/network failure on a fetch the
// render made — and the write site treats them the same: keep the prior good
// render rather than publish the failure as the card's content. Kept as
// distinct fields so the recorded reason survives for an operator to read and
// so each cause can have its own reconcile cadence, but unified here because
// the withholding decision is identical.
function verdictCoversRow(
  diagnostics: Diagnostics | undefined,
  type: 'instance' | 'file',
): boolean {
  return (
    verdictArrayCoversRow(diagnostics?.staleShellFailure, type) ||
    verdictArrayCoversRow(diagnostics?.gatewayFailure, type)
  );
}

// Rows held in the write-behind buffer before a flush is forced (see
// `Batch.bufferEntry`). Dependency reads flush earlier; this only bounds
// memory across long runs of dependency-free files. Renders dwarf the writes,
// so even a forced flush lands in a render's shadow.
const WRITE_BUFFER_FLUSH_THRESHOLD = 100;

// Type-watermark rows written per statement. The set is bounded by the
// realm's type vocabulary rather than its row count, so this only has to keep
// a realm with an unusually large one inside the driver's bound-parameter
// ceiling.
const TYPE_STAMP_CHUNK = 200;

// Touched types past which a pass rebuilds its whole type summary instead of
// recomputing the touched entries and carrying the rest forward. A pass that
// moved this many types is recomputing most of the realm's vocabulary anyway,
// so the scoped form stops being a saving while still binding one parameter
// per key — the same bound-parameter ceiling `TYPE_STAMP_CHUNK` keeps clear of.
const SCOPED_TYPE_SUMMARY_MAX_TYPES = 200;

// How `realm_meta.value` is ordered, shared by both rollup paths so they cannot
// order the same set differently.
//
// `code_ref` is the tiebreak, and it is what makes this a total order: display
// names are not unique — several types can share one, and `MAX(display_names->>0)`
// is NULL for any type none of whose rows carry a label, so those all tie with
// each other. Without a tiebreak the database is free to return tied entries in
// any order, and the scoped path breaks such ties by which arm of its union a
// row came from — so an edit to one type would reshuffle unrelated ones in the
// sidebar. `code_ref` is the group key, so it is unique within each arm.
const TYPE_SUMMARY_ORDER_BY = `ORDER BY display_name ASC NULLS LAST, code_ref ASC`;

// Prefixed onto the realm URL to form the index swap's commit-lock key, so the
// key cannot coincide with any other advisory lock taken on a realm.
const INDEX_COMMIT_LOCK_NAMESPACE = 'index-commit:';

// Where index passes stage their rows until their commit promotes them.
const PENDING_TABLES = ['boxel_index_pending', 'prerendered_html_pending'];

// The columns a staged tombstone sets, besides its key. A tombstone is staged
// with only these, and the swap applies them to the production row in place,
// so everything else on that row stays as production holds it.
const INDEX_TOMBSTONE_COLUMNS = [
  'file_alias',
  'generation',
  'is_deleted',
  'has_error',
  'error_doc',
  'diagnostics',
];
const HTML_TOMBSTONE_COLUMNS = [
  'file_alias',
  'generation',
  'is_deleted',
  'error_doc',
  'diagnostics',
  'rendered_at',
];

// How long an ad-hoc staging (a batch outside a job) goes without a write
// before a commit's janitor clears it. Nothing records whether the batch that
// staged it is still running, so this has to outlast the longest ad-hoc batch
// — an in-browser from-scratch index of a large realm, which runs minutes.
const ADHOC_STAGING_ABANDONED_MS = 24 * 60 * 60 * 1000;

// The `staging_id` of a job's attempt: the job and the reservation the attempt
// runs under, so each attempt stages apart from every other.
export function jobStagingId(jobId: number, reservationId: number): string {
  return `job:${jobId}.${reservationId}`;
}

// How long a realm's `realm_index_commits` rows are kept. Each commit prunes
// its own realm's older rows, so the ledger stays bounded by commit rate.
const INDEX_COMMIT_LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Rows a commit's ledger entry lists before it stops listing them and reads as
// "every URL in the realm" instead. The widest incremental fan-outs seen in
// practice are a few hundred rows — a card that hundreds of others render —
// so ordinary passes are listed exactly. A pass past this is a realm-wide
// event such as an edit to a widely adopted module, and listing it would put a
// realm-sized array on the ledger for every such commit.
const INDEX_COMMIT_LEDGER_MAX_URLS = 2000;

// How many times a commit rolls back to re-visit what peer commits made stale
// (see `CommitValidation`) before it commits anyway and leaves the rest to a
// follow-up job. A round re-visits only what the peers that committed during
// the previous one touched, so it is normally far smaller than the pass. The
// cap is for a realm whose peers keep committing over the same cards, which
// would otherwise hold the pass open for as long as they do.
export const COMMIT_VALIDATION_MAX_ROUNDS = 3;

// One `boxel_index` row as `existingIndexTypes` reads it back.
interface ExistingIndexRowType {
  type: BoxelIndexTable['type'];
  isDeleted: boolean;
  cardTypes: string[] | null;
}

// One consumer `itemsThatReference` found for a path. `renderEdge` is true
// when the consumer references the path only from its `prerendered_html.deps`
// — its HTML used the path, its index visit did not.
interface ReferencingItem {
  url: string;
  alias: string | null;
  type: BoxelIndexTable['type'];
  renderEdge: boolean;
}

// The state of one transitive walk of the reference graph in `invalidate()`.
interface FanOutWalk {
  // Reference scans keyed by path, shared between walks so a path the index
  // walk already scanned costs the full walk nothing.
  references: Map<string, Promise<ReferencingItem[]>>;
  followRenderEdges: boolean;
  visited: Set<string>;
}

export interface BatchDoneResult extends PendingCleanupResult {
  totalIndexEntries: number;
  // How many times the swap's transaction ran: 1 unless a deadlock or
  // serialization failure rolled it back and it ran again.
  swapAttempts: number;
  // Wall-clock spent on attempts that rolled back, so it can be subtracted
  // from the swap's total to get the time of the attempt that committed.
  swapRetryMs: number;
  // How long the committing attempt waited for the realm's commit lock, i.e.
  // for another pass of the same realm to finish committing. Absent for a
  // `prerenderHtmlOnly` batch, which takes no commit lock.
  commitLockWaitMs?: number;
  // Present when the commit checked peer passes that committed while this one
  // ran (see `CommitValidation`). `validationMs` is the wall of every check
  // and every re-visit round, `validationRounds` how many times the commit
  // rolled back to re-visit, `revisitCount` the URLs those rounds re-visited,
  // and `extendCount` the peer-committed URLs the pass extended to, both
  // summed across rounds.
  validationMs?: number;
  validationRounds?: number;
  revisitCount?: number;
  extendCount?: number;
  // The `incremental-index` job the commit enqueued, in its own transaction,
  // when the rounds ran out with rows still stale.
  followUpJobId?: number;
}

// What a commit does about peer passes of its realm that committed while it
// ran. Handed to `Batch.done` only by a pass that can re-visit a URL: the
// index runner's from-scratch and incremental passes. A batch that cannot —
// the setup-error recording, the worker's failed-entry marking, a copy —
// commits without it, and so without checking its peers.
export interface CommitValidation {
  // Re-visits `round.urls` into this batch the way the pass's visit loop did,
  // against the files and the index as they stand now. Called between commit
  // attempts, with the commit lock released.
  revisit(round: CommitValidationRound): Promise<void>;
  // The args of the `incremental-index` job that re-indexes `urls` when the
  // rounds run out and peers still leave some of this pass's rows stale.
  // Absent when the pass has no way to build them; the commit then goes
  // ahead without one and says so in the log.
  followUpJobArgs?(urls: string[]): Record<string, unknown>;
}

export interface CommitValidationRound {
  // 1 for the first re-visit.
  round: number;
  // Every URL to re-visit, sorted: the pass's own URLs a peer's commit made
  // stale, and the fan-out of the peer-committed URLs the pass extends to.
  urls: string[];
  // What the extension added to the pass: index-visited URLs new to its
  // invalidation set, and new render-only dependents. Nothing the pass has
  // announced to its HTML job names these.
  addedURLs: string[];
  addedRenderOnlyURLs: string[];
  // Whether the loader epoch the pass renders under moved since its visits
  // ran. A peer's commit or a module write minted one, so a warm tab can hold
  // modules older than the ones on disk.
  loaderEpochChanged: boolean;
}

// What a validation check found against the peer commits since the pass last
// validated (see `Batch.#findPeerConflicts`).
interface PeerConflicts {
  // The committed generation the check read under the commit lock. Every
  // peer commit up to it is accounted for.
  generation: number;
  // The realm's loader epoch, read under the same lock.
  loaderEpoch: string;
  // How many generations the check covered.
  peerCommits: number;
  // This pass's URLs to re-visit.
  revisit: string[];
  // Peer-committed URLs outside this pass that the pass extends to.
  extend: string[];
}

// What a commit's validation did, reported on `BatchDoneResult` once a check
// has run. A check runs only when a peer committed since the pass last
// validated.
interface ValidationReport {
  checked: boolean;
  validationMs: number;
  validationRounds: number;
  revisitCount: number;
  extendCount: number;
  followUpJobId?: number;
}

// Thrown inside a commit's transaction to roll it back when a validation
// check finds work to re-visit and rounds remain.
class PeerCommitConflict extends Error {
  readonly conflicts: PeerConflicts;
  constructor(conflicts: PeerConflicts) {
    super(
      `peer commits up to generation ${conflicts.generation} left rows this pass staged stale`,
    );
    this.conflicts = conflicts;
  }
}

// What clearing the pending tables after a commit did (see
// `Batch.clearPendingRows`).
export interface PendingCleanupResult {
  // Wall of the whole cleanup: this batch's own rows, then the janitor.
  pendingCleanupMs: number;
  // Rows of this realm the janitor removed because no pass can commit them
  // any more (see `Batch.clearOrphanedPendingRows`), across both pending
  // tables, and how many stagings they belonged to. Absent when the cleanup
  // failed.
  janitorRowsCleared?: number;
  janitorStagingsCleared?: number;
}

export class Batch {
  readonly ready: Promise<void>;
  #invalidations = new Set<string>();
  // The fan-out's render-only dependents: URLs reachable from the changed
  // files only through a `prerendered_html.deps` edge somewhere on the path.
  // Their index rows cannot have moved — anything a card's index visit reads
  // lands in its `boxel_index.deps` — so a split-mode pass leaves them out of
  // `#invalidations` (and so out of the visit loop, the tombstones, and the
  // swap) and hands them to its `prerender_html` job alongside the URLs it
  // does visit. Always empty on the fused path, whose visits render HTML
  // inline and therefore must visit every renderer.
  #renderOnlyInvalidations = new Set<string>();
  // CSS content hashes this batch has already interned into the `scoped_css`
  // table, so a stylesheet shared by many rows in one pass is written once.
  #internedScopedCSSHashes = new Set<string>();
  // Pending-table column lists, read once per batch (see `#pendingColumns`).
  #pendingColumnNames = new Map<string, Promise<string[]>>();
  #nodeResolvedInvalidations: string[] | undefined;
  // URLs an earlier attempt of *this same job* already staged, copied into
  // this attempt's own staging (see `copyEarlierAttemptsRows`), with the
  // last_modified value the previous attempt observed. Populated during
  // `ready`. The visit loop in
  // IndexRunner consults this map to skip work the previous attempt
  // already finished; the from-scratch path additionally compares the
  // stored last_modified against the current EFS mtime so a file that
  // changed mid-attempt is re-visited rather than silently resumed
  // with stale content.
  #resumedRows = new Map<string, number | null>();
  // The card types whose membership in a query this pass could have moved:
  // the adoption chains the invalidated rows held before the pass (so a
  // deletion, or a card that changed what it adopts from, still names the
  // type it is leaving) unioned with the chains of every row the pass wrote.
  // A row with no chain — a plain file, a module — contributes nothing, and
  // it cannot satisfy a type-anchored filter in either state, so it needs no
  // representation here. Keys are `internalKeyFor` spellings, the same form
  // `boxel_index.types` stores and a type filter compiles to.
  #touchedTypes = new Set<string>();
  // URLs whose production adoption chain this batch read before writing —
  // the pre-pass half of `#touchedTypes`, recorded by `tombstoneEntries` for
  // every URL in the set it is handed. A row written without that read can be
  // *leaving* a type nothing else in the pass names, so `#touchedTypes` only
  // accounts for everything that moved when this set covers every URL the
  // swap promotes (see `typeSetIsComplete`).
  #preReadURLs = new Set<string>();
  // Whether `applyBatchUpdates` published this pass's `prerendered_html` rows,
  // which decides whether the pass stamps the HTML leg of its type
  // watermarks. Set there rather than recomputed at stamp time so the two
  // cannot drift.
  #publishedPrerenderedHtml = false;
  // Set only while `done()`'s transaction runs. `#query` sends every statement
  // through it then, so the swap's statements share one connection and commit
  // or roll back together.
  #txQuerier: Querier | undefined;
  #tombstonedLiveTypes = new Map<string, BoxelIndexTable['type'][]>();
  #prerenderedHtmlTombstonedLiveTypes = new Map<
    string,
    PrerenderedHtmlTable['type'][]
  >();
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
  // flush check in `getDependencyRows`. Each item carries the `seq` it was
  // stamped with on the way in, so buffering — which reorders nothing but
  // does collapse many rows into one timestamp — cannot blur the write order
  // the row records.
  #writeBuffer: { url: URL; entry: SearchIndexEntry; seq: number }[] = [];
  #writeBufferUrls = new Set<string>();
  // Monotonic counter behind `diagnostics.writeSeq`, reset alongside
  // `#currentInvalidationId` so the two stamps always describe the same
  // fan-out. Advanced where a row enters the write path (`bufferEntry` /
  // `updateEntry`) rather than where it is prepared, so the sequence records
  // the order the pass produced its rows — which for an index pass is its
  // visit order — independent of how the buffer batches the physical
  // upserts. Tombstones do not advance it: `invalidate()` writes one for
  // every URL in the fan-out before any visit, and a visited URL's row
  // overwrites its tombstone, so counting them would leave a gap for every
  // URL rather than describe an order.
  //
  // `#writePositions` holds the position each row has already taken, so a
  // row written more than once in a pass keeps its first — the position
  // records where in the pass the work on that row began, and a rewrite is
  // that same work continuing. Keyed by row rather than by URL (a card's
  // `file` and `instance` halves are separate rows), and held for the whole
  // fan-out rather than for one buffer drain, because a rewrite can land on
  // either side of a flush. A rewrite consumes no position, so a fan-out's
  // sequences are gapless.
  //
  // A retried job is the one case where a promoted generation holds rows
  // from two batches: `loadResumedRows` keeps the previous attempt's rows as
  // they are, so they retain that attempt's `invalidationId` and its
  // sequences, and only the URLs this attempt visits carry the current pair.
  // Ordering within one `invalidationId` stays sound; a query that wants the
  // whole generation has to union the attempts' ids rather than assume one.
  #writeSeq = 0;
  #writePositions = new Map<string, number>();
  // Aggregate wall of every physical `boxel_index_pending` write in this
  // batch, surfaced on the job result's `phaseTimings.writeMs`.
  #writeMs = 0;
  #dbAdapter: DBAdapter;
  #perfLog = logger('index-perf');
  #log = logger('index-writer');
  // The source realm of a copy batch, set by `copyFrom`. `applyBatchUpdates`
  // uses it to fill the destination's prerendered_html channel from the
  // source realm's `prerendered_html` rows.
  #copyFromSourceRealm: URL | undefined;
  // When true (the server/Postgres path), HTML prerendering runs as a separate
  // `prerender_html` job, so this index batch writes only `boxel_index` and
  // leaves the `prerendered_html` channel to that job. When false (the fused
  // path — the SQLite in-browser/test realm, which has no separate worker), the
  // batch writes each entry's HTML half into `prerendered_html_pending` inline
  // (in `updateEntry`, with tombstones mirrored in `tombstoneEntries`).
  // Defaults to `dbAdapter.kind === 'pg'`; a copy batch fills the channel
  // either way via `copyPrerenderedHtmlFrom` (guarded by
  // `#copyFromSourceRealm` in `applyBatchUpdates`).
  #splitPrerenderHtml: boolean;
  // When true, this batch is the `prerender_html` job's batch: it writes only
  // the `prerendered_html` channel (not `boxel_index`), stamps each row with
  // the generation of the live index row it renders (see
  // `adoptIndexGenerations`) without advancing `realm_generations`, and its
  // swap carries a monotonic guard. The tombstone / last-known-good / resume / write logic is
  // otherwise identical to an index batch — the fan-out is not recomputed here
  // (it ran once in the index pass and is seeded via
  // `seedPrerenderedHtmlInvalidations`).
  #prerenderHtmlOnly: boolean;
  // A `prerenderHtmlOnly` batch's per-row stamps: each URL's live
  // `boxel_index` generation by row type, read once the job's spawning passes
  // have committed. Undefined until `adoptIndexGenerations` runs.
  #indexGenerations: Map<string, number> | undefined;
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
  // `current_generation + 1` as read when the batch was set up, and stamped on
  // the rows the pass stages in the pending tables. It is only a guess at the
  // number the pass will commit under — a peer that commits first takes it —
  // so it is never compared against committed state and never used to tell
  // this pass's rows from a peer's (`#stagingId` does that); the swap
  // restamps every row it promotes with the generation allocated at commit.
  //
  // A prerenderHtmlOnly batch allocates nothing: this holds the realm's
  // committed generation as `adoptIndexGenerations` read it, and its rows are
  // stamped per URL from the live index rather than with this value.
  #provisionalGeneration = 0;
  // The `current_generation` the pass was set up against: the committed state
  // its fan-out was computed from.
  #baseGeneration = 0;
  // The committed generation this pass's rows have been checked against. The
  // base generation until a validation round re-visits for its peers, then
  // the generation that round's check read: every peer commit up to it has
  // been accounted for, so the next check reads only the ones after it.
  #validatedGeneration = 0;
  // 0 until the commit rolls back to re-visit for its peers, then the number
  // of the round in progress. Stamped as `diagnostics.validationRound` on
  // every row the round writes.
  #validationRound = 0;
  // Allocated inside the swap's transaction, while the commit lock is held, so
  // generations follow commit order. Set on every attempt of the transaction;
  // `#committedGeneration` is set only once one of them has committed.
  #commitGenerationInTransaction: number | undefined;
  #committedGeneration: number | undefined;
  // Identifies this pass on its `realm_index_commits` ledger row, and on the
  // `diagnostics` of every row it writes.
  #passId = uuidv4();
  // The `staging_id` this batch's rows carry in the pending tables. Every
  // staging read and write is scoped to it, so the batch sees committed rows
  // plus its own staged ones, never a peer pass's. A job's attempt stages
  // under `jobStagingId(job, reservation)`: two attempts that overlap (a lease
  // that lapsed while its worker was stalled) never read or clear each
  // other's rows, and a retry resumes by copying an earlier attempt's rows in
  // (`loadResumedRows`). A batch outside a job stages under
  // `adhoc:<pass id>`, which nothing else shares.
  #stagingId: string;
  // Whether this pass rebuilt the whole realm (a from-scratch index or a
  // copy), as opposed to an incremental fan-out; recorded on the ledger row.
  #fullRealm = false;
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
    },
  ) {
    this.realmURL = realmURL;
    this.virtualNetwork = virtualNetwork;
    this.jobInfo = jobInfo;
    this.#dbAdapter = dbAdapter;
    this.#splitPrerenderHtml =
      opts?.splitPrerenderHtml ?? dbAdapter.kind === 'pg';
    this.#prerenderHtmlOnly = opts?.prerenderHtmlOnly ?? false;
    this.#stagingId =
      jobInfo && jobInfo.jobId > 0
        ? jobStagingId(jobInfo.jobId, jobInfo.reservationId)
        : `adhoc:${this.#passId}`;
    this.#currentInvalidationId = uuidv4();
    this.ready = this.setupBatch();
  }

  // Whether this batch defers HTML to the `prerender_html` job (server) rather
  // than projecting it inline (fused / SQLite). Read by the index-runner visit
  // loop (to skip the inline prerender-html visit) and the enqueue callback.
  get splitPrerenderHtml(): boolean {
    return this.#splitPrerenderHtml;
  }

  // The generation this batch stages its rows under (see
  // `#provisionalGeneration`). For work that runs before the pass commits.
  // Committed state is compared against `committedGeneration` instead.
  get provisionalGeneration(): number {
    return this.#provisionalGeneration;
  }

  // The generation this batch's swap committed under: the value its commit
  // wrote to `realm_generations.current_generation`. Read by the job result
  // and the index event, after `done()`.
  get committedGeneration(): number {
    if (this.#committedGeneration === undefined) {
      throw new Error(
        `the index batch for ${this.realmURL.href} has not committed, so it has no committed generation`,
      );
    }
    return this.#committedGeneration;
  }

  // The committed `current_generation` this batch was set up against.
  get baseGeneration(): number {
    return this.#baseGeneration;
  }

  // Identifies this batch on its `realm_index_commits` row. Minted per batch,
  // so it tells apart two commits under one job id, which a rerun of the same
  // job produces.
  get passId(): string {
    return this.#passId;
  }

  // The `staging_id` this batch's pending rows carry (see `#stagingId`).
  get stagingId(): string {
    return this.#stagingId;
  }

  private get commitGeneration(): number {
    if (this.#commitGenerationInTransaction === undefined) {
      throw new Error(
        `the index batch for ${this.realmURL.href} stamped a commit-time generation outside its commit`,
      );
    }
    return this.#commitGenerationInTransaction;
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
      this.#hasExecutableInvalidation = passInvalidatesExecutables(
        this.#invalidations,
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
      this.#hasExecutableInvalidation = passInvalidatesExecutables(urls);
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
      // The `prerender_html` job never advances `realm_generations`. Its
      // stamps are read from the live index once its spawning passes have
      // committed (`adoptIndexGenerations`), and the monotonic swap guard in
      // `done()` keeps an out-of-order job from overwriting newer rows.
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
    await this.copyEarlierAttemptsRows();
    // Exclude `has_error = true` rows. A retry exists precisely so a
    // transient failure (renderer hang, network blip, OOM) gets a
    // second chance — preserving the prior error row would freeze
    // the URL in the failed state until some unrelated change kicks
    // a different job. Tombstones (`is_deleted = true`) are
    // similarly excluded so the deletion intent flows through to
    // `applyBatchUpdates` instead of being skipped as resumed work.
    let rows = (await this.#query([
      `SELECT url, last_modified, types FROM boxel_index_pending WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['staging_id =', param(this.#stagingId)],
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
        any([['has_error = false'], ['has_error IS NULL']]),
      ]),
    ] as Expression)) as Pick<
      BoxelIndexTable,
      'url' | 'last_modified' | 'types'
    >[];
    for (let { url, last_modified, types } of rows) {
      // The chain the previous attempt wrote is this row's post-pass state:
      // the visit loop skips a resumed URL, so it never reaches the write
      // path that would otherwise record it. Without this a card the crashed
      // attempt created — which has no production row for the pre-pass read
      // to find either — would be absent from the pass's reported types
      // entirely, and a query anchored on its type would sit out the very
      // pass that published it.
      this.#recordTouchedTypes(types);
      this.#resumedRows.set(
        url,
        last_modified == null ? null : parseInt(last_modified),
      );
      // Pre-seed the in-memory invalidation set so `applyBatchUpdates`
      // promotes the resumed rows even though no `updateEntry` /
      // `invalidate` call in this attempt added them. Without this, the
      // commit would delete resumed work from the pending table without
      // ever promoting it, because the SELECT ... INTO boxel_index keys on
      // `#invalidations`.
      this.#invalidations.add(url);
    }
    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} resuming ${this.#resumedRows.size} URLs from prior attempt for ${this.realmURL.href}`,
    );
  }

  // The `prerendered_html` analog of `loadResumedRows`, for a
  // `prerenderHtmlOnly` batch: resume from `prerendered_html_pending` rows a
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
    await this.copyEarlierAttemptsPrerenderedHtmlRows();
    let rows = (await this.#query([
      `SELECT url FROM prerendered_html_pending WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['staging_id =', param(this.#stagingId)],
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

  // Copies into this attempt's staging the rows earlier attempts of its job
  // staged that it can resume: the newest live, unerrored row per URL and
  // type across those attempts. Each attempt stages under its own id, so this
  // is the only way one attempt's work reaches another — and a copy, so an
  // earlier attempt that is still running (its lease lapsed while it stalled)
  // keeps its own rows and cannot clear this attempt's. On the fused path a
  // copied index row brings its HTML row from the same attempt, since the
  // visit that wrote one wrote the other. A row this staging already holds is
  // left as it is.
  private async copyEarlierAttemptsRows(): Promise<void> {
    let jobId = this.jobInfo!.jobId;
    let columns = await this.#pendingColumns('boxel_index_pending');
    let chosen = [
      'SELECT * FROM (',
      'SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.url, p.type ORDER BY p.indexed_at DESC) AS resume_rank',
      'FROM boxel_index_pending AS p WHERE',
      ...every([
        ['p.realm_url =', param(this.realmURL.href)],
        ['p.job_id =', param(jobId)],
        ['p.staging_id <>', param(this.#stagingId)],
        any([['p.is_deleted = false'], ['p.is_deleted IS NULL']]),
        any([['p.has_error = false'], ['p.has_error IS NULL']]),
      ]),
      ') AS ranked WHERE ranked.resume_rank = 1',
    ] as Expression;
    await this.#query([
      'INSERT INTO boxel_index_pending',
      ...addExplicitParens(
        separatedByCommas([...columns.map((c) => [c]), ['staging_id']]),
      ),
      'SELECT',
      ...separatedByCommas([
        ...columns.map((c) => [`earlier.${c}`]),
        ['CAST(', param(this.#stagingId), 'AS VARCHAR)'],
      ]),
      'FROM (',
      ...chosen,
      ') AS earlier WHERE earlier.url IS NOT NULL',
      'ON CONFLICT ON CONSTRAINT boxel_index_pending_pkey DO NOTHING',
    ] as Expression);
    if (this.#splitPrerenderHtml) {
      return;
    }
    let htmlColumns = await this.#pendingColumns('prerendered_html_pending');
    await this.#query([
      'INSERT INTO prerendered_html_pending',
      ...addExplicitParens(
        separatedByCommas([...htmlColumns.map((c) => [c]), ['staging_id']]),
      ),
      'SELECT',
      ...separatedByCommas([
        ...htmlColumns.map((c) => [`h.${c}`]),
        ['CAST(', param(this.#stagingId), 'AS VARCHAR)'],
      ]),
      'FROM prerendered_html_pending AS h JOIN (',
      ...chosen,
      ') AS earlier',
      'ON earlier.url = h.url AND earlier.type = h.type AND earlier.staging_id = h.staging_id',
      'WHERE',
      ...every([['h.realm_url =', param(this.realmURL.href)]]),
      'ON CONFLICT ON CONSTRAINT prerendered_html_pending_pkey DO NOTHING',
    ] as Expression);
  }

  // The `prerendered_html_pending` analog of `copyEarlierAttemptsRows`, for a
  // `prerenderHtmlOnly` batch: the newest live, unerrored rendering per URL
  // and type that earlier attempts of its job staged.
  private async copyEarlierAttemptsPrerenderedHtmlRows(): Promise<void> {
    let columns = await this.#pendingColumns('prerendered_html_pending');
    await this.#query([
      'INSERT INTO prerendered_html_pending',
      ...addExplicitParens(
        separatedByCommas([...columns.map((c) => [c]), ['staging_id']]),
      ),
      'SELECT',
      ...separatedByCommas([
        ...columns.map((c) => [`earlier.${c}`]),
        ['CAST(', param(this.#stagingId), 'AS VARCHAR)'],
      ]),
      'FROM (',
      'SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.url, h.type ORDER BY h.rendered_at DESC) AS resume_rank',
      'FROM prerendered_html_pending AS h WHERE',
      ...every([
        ['h.realm_url =', param(this.realmURL.href)],
        ['h.job_id =', param(this.jobInfo!.jobId)],
        ['h.staging_id <>', param(this.#stagingId)],
        any([['h.is_deleted = false'], ['h.is_deleted IS NULL']]),
        ['h.error_doc IS NULL'],
      ]),
      ') AS earlier WHERE earlier.resume_rank = 1',
      'ON CONFLICT ON CONSTRAINT prerendered_html_pending_pkey DO NOTHING',
    ] as Expression);
  }

  // A pending table's columns other than `staging_id`, which a copy sets
  // itself. Read once per batch.
  #pendingColumns(
    table: 'boxel_index_pending' | 'prerendered_html_pending',
  ): Promise<string[]> {
    let columns = this.#pendingColumnNames.get(table);
    if (!columns) {
      columns = this.#dbAdapter
        .getColumnNames(table)
        .then((names) => names.filter((name) => name !== 'staging_id'));
      this.#pendingColumnNames.set(table, columns);
    }
    return columns;
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

  // Populate `#tombstonedLiveTypes` for `urls` straight from the production
  // index, WITHOUT tombstoning or computing a fan-out — the same live-type
  // memory `invalidate()` records, but for a batch that never invalidated.
  // The setup-phase failure recovery uses a fresh batch (it must not reuse the
  // in-flight batch, whose invalidation set covers fan-out tombstones a
  // `done()` would promote); that fresh batch has no tombstone memory, so
  // without this it would fall back to re-reading each file to decide "was
  // this a card?". The two batches run for the same attempt of the same job
  // and so share one staging id: any URL the fresh batch then failed to
  // re-classify (a read blip, non-card on-disk content) would leave the
  // in-flight batch's `instance` tombstone in the attempt's pending rows to be
  // promoted — silently deleting a previously-good card. Seeding from the
  // index (the reliable oracle) closes that.
  async seedLiveTypesFromProduction(urls: URL[]): Promise<void> {
    await this.ready;
    if (urls.length === 0) {
      return;
    }
    let existingTypes = await this.existingIndexTypes(urls.map((u) => u.href));
    for (let [url, entries] of existingTypes) {
      let liveTypes = entries
        .filter((entry) => !entry.isDeleted)
        .map((entry) => entry.type);
      if (liveTypes.length > 0) {
        this.#tombstonedLiveTypes.set(url, liveTypes);
      }
    }
  }

  /**
   * The prerendered_html analog of `tombstonedLiveTypes`: row types
   * `tombstonePrerenderedHtmlEntries` overwrote with tombstones this pass,
   * restricted to rows that were live in production `prerendered_html`.
   * The prerender-html visit loop's per-URL failure isolation consults
   * this to decide whether a failed URL had a card instance to protect —
   * the rendered table is a more reliable oracle than re-reading the
   * file, since the read path may be exactly what failed.
   */
  prerenderedHtmlTombstonedLiveTypes(
    url: string,
  ): PrerenderedHtmlTable['type'][] | undefined {
    return this.#prerenderedHtmlTombstonedLiveTypes.get(url);
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

  // See `#renderOnlyInvalidations`: the URLs whose HTML this pass's fan-out
  // reached but whose index rows it leaves alone.
  get renderOnlyInvalidations() {
    return [...this.#renderOnlyInvalidations];
  }

  /**
   * The deduped adoption-chain keys this pass touched — see `#touchedTypes`.
   * Bounded by the realm's type count rather than its row count, which is
   * what makes it safe to put on a broadcast event whose `invalidations`
   * list can run to thousands of URLs.
   */
  get touchedTypes(): string[] {
    return [...this.#touchedTypes];
  }

  #recordTouchedTypes(types: string[] | null | undefined): void {
    for (let type of types ?? []) {
      this.#touchedTypes.add(type);
    }
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
      entry.generation = this.#provisionalGeneration;
      entry.job_id = this.jobInfo?.jobId ?? null;
      entry.staging_id = this.#stagingId;
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
        'boxel_index_pending',
        'boxel_index_pending_pkey',
        columns,
        values,
      ),
    ]);

    // `applyBatchUpdates` fills the destination's prerendered_html channel
    // from the source realm's `prerendered_html` rows.
    this.#copyFromSourceRealm = sourceRealmURL;
    this.#fullRealm = true;
  }

  // Copy the source realm's `prerendered_html` rows onto the destination's
  // `prerendered_html_pending`, so a copied realm keeps its prerendered HTML
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
    let manifestCopies: {
      sourceLedgerURL: string;
      destLedgerURL: string;
      manifest: ScreenshotManifest;
    }[] = [];
    let values = sources.map((entry) => {
      let destURL = copyURL(entry.url);
      // The source's `prerendered_html` rows are a subset of its `boxel_index`
      // rows, so `copyFrom` already seeded these into `#invalidations`; add
      // defensively so the swap below promotes every overlaid HTML row.
      this.#invalidations.add(destURL);
      if (entry.screenshots && Object.keys(entry.screenshots).length > 0) {
        let kind: 'instance' | 'file' =
          entry.type === 'instance' ? 'instance' : 'file';
        manifestCopies.push({
          sourceLedgerURL: screenshotLedgerSourceURL(entry.url, kind),
          destLedgerURL: screenshotLedgerSourceURL(destURL, kind),
          manifest: entry.screenshots as ScreenshotManifest,
        });
      }
      entry.url = destURL;
      entry.realm_url = this.realmURL.href;
      entry.file_alias = copyURL(entry.file_alias);
      entry.generation = this.commitGeneration;
      entry.rendered_at = now;
      entry.job_id = this.jobInfo?.jobId ?? null;
      entry.staging_id = this.#stagingId;
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
        'prerendered_html_pending',
        'prerendered_html_pending_pkey',
        columns,
        values,
      ),
    ]);
    await this.copyDeclaredScreenshotLedgerRows(sourceRealmURL, manifestCopies);
  }

  // A copied manifest is only as durable as the ledger rows that refcount
  // its objects, and those exist solely under the source realm — once the
  // source card re-renders (superseding) or is deleted (tombstoning), GC
  // reclaims the objects and every copied manifest dangles. Duplicate the
  // source's `declared`-lane rows under the destination realm and rewritten
  // source URL so the copies hold their own references. Metadata-only: the
  // object store is content-addressed, so no bytes move. A manifest entry
  // whose source row is already gone stays as dangling in the copy as it was
  // in the source. Runs only when a manifest was copied, so it never touches
  // `media_cache_ledger` on adapters that don't carry it (captures only ever
  // happen on the Postgres side).
  private async copyDeclaredScreenshotLedgerRows(
    sourceRealmURL: URL,
    copies: {
      sourceLedgerURL: string;
      destLedgerURL: string;
      manifest: ScreenshotManifest;
    }[],
  ): Promise<void> {
    if (copies.length === 0) {
      return;
    }
    let sourceURLs = [...new Set(copies.map((c) => c.sourceLedgerURL))];
    let sourceRows = (await this.#query([
      `SELECT * FROM media_cache_ledger WHERE`,
      ...every([
        ['realm_url =', param(sourceRealmURL.href)],
        [`lane = 'declared'`],
        [
          'source_url IN',
          ...addExplicitParens(
            separatedByCommas(sourceURLs.map((u) => [param(u)])),
          ),
        ],
      ]),
    ] as Expression)) as unknown as {
      source_url: string;
      capture_spec_hash: string;
      object_key: string;
      source_content_hash: string | null;
      content_type: string;
      size_bytes: string | number;
      width: number | null;
      height: number | null;
    }[];
    let byIdentity = new Map(
      sourceRows.map((row) => [
        `${row.source_url}\n${row.capture_spec_hash}\n${row.object_key}`,
        row,
      ]),
    );
    let now = Date.now();
    let columns: string[][] | undefined;
    let values: any[][] = [];
    for (let { sourceLedgerURL, destLedgerURL, manifest } of copies) {
      for (let entry of Object.values(manifest)) {
        let source = byIdentity.get(
          `${sourceLedgerURL}\n${entry.specHash}\n${entry.objectKey}`,
        );
        if (!source) {
          continue;
        }
        let { nameExpressions, valueExpressions } = asExpressions({
          realm_url: this.realmURL.href,
          source_url: destLedgerURL,
          capture_spec_hash: source.capture_spec_hash,
          source_generation: this.commitGeneration,
          object_key: source.object_key,
          source_content_hash: source.source_content_hash,
          lane: 'declared',
          content_type: source.content_type,
          size_bytes: source.size_bytes,
          width: source.width,
          height: source.height,
          created_at: now,
          last_accessed_at: now,
        });
        columns = nameExpressions;
        values.push(valueExpressions);
      }
    }
    if (!columns) {
      return;
    }
    await this.#query([
      ...upsertMultipleRows(
        'media_cache_ledger',
        'media_cache_ledger_pkey',
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
    this.#writeBuffer.push({
      url,
      entry,
      seq: this.#positionOf(url, rowType(entry)),
    });
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
        // Last write wins when the same row was buffered twice: a single
        // multi-row upsert can't touch one conflict target twice. Only the
        // contents are the later write's — both items carry the position the
        // row took when the pass first wrote it (see `#positionOf`).
        let deduped = new Map<
          string,
          { url: URL; entry: SearchIndexEntry; seq: number }
        >();
        for (let item of buffered) {
          deduped.set(`${item.url.href}|${rowType(item.entry)}`, item);
        }
        let prepared = await Promise.all(
          [...deduped.values()].map(({ url, entry, seq }) =>
            this.#prepareIndexRow(url, entry, seq),
          ),
        );
        await this.#upsertIndexRows(prepared);
      } else {
        for (let { url, entry, seq } of buffered) {
          await this.#writeEntryNow(url, entry, seq);
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

  // Aggregate wall of every physical `boxel_index_pending` write in this
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
      await this.#writeEntryNow(
        url,
        entry,
        this.#positionOf(url, rowType(entry)),
      );
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
  // lands first: the boxel_index_pending row is the resume marker
  // (`loadResumedRows` skips URLs it finds), so writing it last means a crash
  // between the two writes re-visits the URL rather than resuming a row whose
  // rendering never landed. (A split-mode batch writes no HTML — its spawned
  // `prerender_html` job owns that channel.)
  async #writeEntryNow(
    url: URL,
    entry: SearchIndexEntry,
    seq: number,
  ): Promise<void> {
    let { preparedEntry, htmlEntry } = await this.#prepareIndexRow(
      url,
      entry,
      seq,
    );
    if (!this.#splitPrerenderHtml) {
      await this.writePrerenderedHtmlRow(url, htmlEntry, seq);
    }
    let { nameExpressions, valueExpressions } = asExpressions(preparedEntry, {
      jsonFields: this.#jsonColumnNames(),
    });
    await this.#query([
      ...upsert(
        'boxel_index_pending',
        'boxel_index_pending_pkey',
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
            'boxel_index_pending',
            'boxel_index_pending_pkey',
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
            'boxel_index_pending',
            'boxel_index_pending_pkey',
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

  // The position `url`'s `type` row takes in this fan-out's write order:
  // the next number the first time the pass writes that row, and the same
  // number every time after. See `#writePositions`.
  #positionOf(url: URL, type: BoxelIndexTable['type']): number {
    let key = `${url.href}|${type}`;
    let taken = this.#writePositions.get(key);
    if (taken !== undefined) {
      return taken;
    }
    let position = this.#writeSeq++;
    this.#writePositions.set(key, position);
    return position;
  }

  // The write-side stamps every row this batch writes carries, on both
  // channels: which pass wrote it, when, and where it sits in that pass's
  // write order. `seq` comes from the caller rather than from `#writeSeq`
  // here, so the two rows a fused visit produces — its `boxel_index` half
  // and its `prerendered_html` half — share one position instead of
  // consuming two.
  #writeSideStamps(seq: number): Diagnostics {
    return {
      invalidationId: this.#currentInvalidationId,
      passId: this.#passId,
      indexedAt: Date.now(),
      writeSeq: seq,
      ...this.#validationRoundStamp(),
    };
  }

  // `validationRound`, on a row a validation round writes.
  #validationRoundStamp(): Pick<Diagnostics, 'validationRound'> {
    return this.#validationRound > 0
      ? { validationRound: this.#validationRound }
      : {};
  }

  // Build the sanitized `boxel_index_pending` row payload — and the paired
  // `prerendered_html` entry the fused path writes — for an entry, without
  // performing the upsert.
  //
  // The per-row diagnostics blob is assembled here: render-side fields come
  // from the Prerenderer's `response.meta` (already flattened in
  // `visit-file.ts`); the write-side `invalidationId` (minted once per Batch,
  // so every row from the same pass shares a queryable correlation key) and
  // `indexedAt` are stamped now, alongside the `writeSeq` its caller assigned
  // when the row entered the write path. The canonical storage is the
  // `diagnostics` column; for error rows the blob is ALSO mirrored onto
  // `error_doc.diagnostics` so the UI read path keeps working unchanged.
  // jsonb-illegal bytes are stripped once, over the whole row, by the
  // `sanitizeForJsonb` at the end.
  async #prepareIndexRow(
    url: URL,
    entry: SearchIndexEntry,
    writeSeq: number,
  ): Promise<PreparedIndexRow> {
    let href = url.href;
    let diagnostics: Diagnostics = {
      ...(entry.diagnostics ?? {}),
      ...this.#writeSideStamps(writeSeq),
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
          source_content_hash: entry.sourceContentHash ?? null,
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
        // A failure the prerender server marked unattributable to the card is
        // not published as the card's content, provided there is content to
        // keep: the carried-forward `pristine_doc` and friends stay as the last
        // good pass left them and `has_error` stays false, so readers keep
        // seeing the card until a render that *can* be attributed replaces it.
        //
        // Presence of the mark is the whole test. The conclusion belongs to the
        // prerender server, which is the only place holding the tokens it rests
        // on, so this site does not re-derive it — one implementation of the
        // rule rather than two that can drift. Absence means no verdict, never
        // "attributable", so nothing is withheld by default.
        //
        // Gated on a prior published row. A brand-new card has no good content
        // to protect, and withholding its error would leave nothing at all —
        // the failure has to surface somewhere, and an error row is the right
        // output there even when the environment caused it.
        let withholdFailure =
          verdictCoversRow(diagnostics, baseTypeFromError(entry)) &&
          Boolean(production.pristine_doc);
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
          //
          // A withheld failure keeps the published doc untouched instead: the
          // error's sparse searchData describes a render whose result is not
          // being published, so overlaying it would degrade a row that is
          // otherwise staying exactly as the last good pass left it.
          search_doc: withholdFailure
            ? (production.search_doc ?? null)
            : entry.searchData
              ? { ...(production.search_doc ?? {}), ...entry.searchData }
              : (production.search_doc ?? null),
          // preserve last_known_good_deps through error cycles (may have been cleared
          // by getProductionVersion if it returned undefined, so we explicitly preserve it)
          last_known_good_deps: await this.getLastKnownGoodDeps(
            url,
            baseTypeFromError(entry),
          ),
          type: baseTypeFromError(entry),
          // A failure the prerender server marked unattributable to the card
          // is not published as the card's content, provided there is content
          // to keep. The row's carried-forward `pristine_doc` and friends stay
          // exactly as the last good pass left them, and `has_error` is left
          // false, so readers keep seeing the card until a render that can be
          // attributed replaces it.
          //
          // Presence of the mark is the whole test — the conclusion is the
          // prerender server's, which is the only place holding the tokens it
          // rests on. Absence means no verdict, never "attributable", so
          // nothing is withheld by default.
          //
          // Gated on there being a prior published row. A brand-new card has no
          // good content to protect, and withholding its error would leave
          // nothing at all: the failure has to surface somewhere, and an error
          // row is the right output there even if the environment caused it.
          error_doc: withholdFailure
            ? null
            : (errorEntry?.error ?? entry.error),
          has_error: !withholdFailure,
          // Restated after `...production`, which carries the previous row's
          // whole shape — its generation included — and would otherwise win
          // over the one assigned below, since `entryPayload` is spread last.
          //
          // Which of the two is right depends on whose content this row ends
          // up serving, and the two error paths differ. A withheld failure
          // republishes the last good render untouched, so the row still shows
          // that bundle's work and keeps its generation: restamping it with
          // this render's would claim the withheld attempt produced content it
          // did not. A published error is this render's own output, so it
          // takes this render's generation — and that is the case a repair
          // most needs to find, which carrying the previous number forward
          // would hide.
          host_shell_generation: withholdFailure
            ? (production.host_shell_generation ?? null)
            : (diagnostics.warmedHostShellGeneration ?? null),
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
      generation: this.#provisionalGeneration,
      // The host bundle that rendered this row, as an ordering rather than the
      // hash beside it in `diagnostics`. Promoted out of the jsonb into its own
      // indexed column because the query it exists for — every row below the
      // shell now being served — is a range scan over the largest table here,
      // and a jsonb extract has no index to walk.
      //
      // `null` when the render reported no number, which is unknown rather than
      // old. `< current` excludes null, so such a row stays out of a repair
      // instead of being swept into the first one that runs.
      host_shell_generation: diagnostics.warmedHostShellGeneration ?? null,
      realm_url: this.realmURL.href,
      is_deleted: false,
      indexed_at: Date.now(),
      job_id: this.jobInfo?.jobId ?? null,
      ...entryPayload,
      // Last, so nothing the payload carries can move the row to another
      // pass's staging.
      staging_id: this.#stagingId,
    } as Omit<BoxelIndexTable, 'last_modified' | 'indexed_at'> & {
      // we do this because pg automatically casts big ints into strings, so
      // we unwind that to accurately type the structure that we want to pass
      // _in_ to the DB
      last_modified: number;
      indexed_at: number;
    };
    // The post-pass half of `#touchedTypes`. Taken from the prepared row
    // rather than from `entry`, so an error row that fell back to its last
    // known good chain is recorded under the chain it actually persists.
    this.#recordTouchedTypes(preparedEntry.types);

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
      preparedEntry.deps = await this.internScopedCSSDeps(
        this.virtualNetwork.unresolveURLs(preparedEntry.deps),
      );
    }
    if (preparedEntry.last_known_good_deps) {
      preparedEntry.last_known_good_deps = await this.internScopedCSSDeps(
        this.virtualNetwork.unresolveURLs(preparedEntry.last_known_good_deps),
      );
    }
    if (preparedEntry.error_doc?.deps) {
      preparedEntry.error_doc.deps = await this.internScopedCSSDeps(
        preparedEntry.error_doc.deps,
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

  // Fix a prerenderHtmlOnly batch's stamps: every row it writes for a URL
  // takes the generation the live `boxel_index` row of the same URL and type
  // holds right now. The job calls this once its spawning passes have
  // committed, so those rows are what the passes published — and a stamp read
  // from the row it renders is exactly the generation the read path and the
  // reconcile sweep compare it against, even when a peer pass of the realm
  // committed in between. A URL with no index row of that type (a render that
  // outran its index row, or a file the index never saw) takes the realm's
  // committed generation instead.
  //
  // The index rows are read before `current_generation`: a swap publishes
  // both in one transaction, so reading in that order keeps the realm
  // generation at or above every row read. That realm generation is the
  // batch's own — the value it reports, and the one its type watermarks
  // carry. Returns it.
  async adoptIndexGenerations(urls: string[]): Promise<number> {
    if (!this.#prerenderHtmlOnly) {
      throw new Error(
        `adoptIndexGenerations is only valid on a prerenderHtmlOnly batch`,
      );
    }
    await this.ready;
    let indexGenerations = new Map<string, number>();
    let uniqueURLs = [...new Set(urls)];
    for (let offset = 0; offset < uniqueURLs.length; offset += 10000) {
      let chunk = uniqueURLs.slice(offset, offset + 10000);
      let rows = (await this.#query([
        'SELECT url, type, generation FROM boxel_index WHERE',
        ...every([
          ['realm_url =', param(this.realmURL.href)],
          [
            'url IN',
            ...addExplicitParens(
              separatedByCommas(chunk.map((url) => [param(url)])),
            ),
          ],
        ]),
      ] as Expression)) as Pick<
        BoxelIndexTable,
        'url' | 'type' | 'generation'
      >[];
      for (let { url, type, generation } of rows) {
        indexGenerations.set(indexGenerationKey(url, type), Number(generation));
      }
    }
    let [row] = (await this.#query([
      'SELECT current_generation FROM realm_generations WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmGenerationsTable, 'current_generation'>[];
    this.#provisionalGeneration = row ? Number(row.current_generation) : 0;
    this.#indexGenerations = indexGenerations;
    return this.#provisionalGeneration;
  }

  // The generation this batch stamps on the `prerendered_html` row of `url`
  // and `type` — and on anything else keyed to that rendering, such as its
  // screenshot ledger rows. On a prerenderHtmlOnly batch that is the live
  // index row's generation (see `adoptIndexGenerations`); on any other batch,
  // the generation it stages its rows under.
  htmlRowGeneration(url: string, type: BoxelIndexTable['type']): number {
    if (!this.#prerenderHtmlOnly) {
      return this.#provisionalGeneration;
    }
    return (
      this.#adoptedIndexGenerations().get(indexGenerationKey(url, type)) ??
      this.#provisionalGeneration
    );
  }

  #adoptedIndexGenerations(): Map<string, number> {
    if (!this.#indexGenerations) {
      throw new Error(
        `the prerender-html batch for ${this.realmURL.href} wrote a row before adopting the index generations it stamps`,
      );
    }
    return this.#indexGenerations;
  }

  // Seed a prerenderHtmlOnly batch's invalidation set from the changes the
  // spawning index pass computed — the dependency fan-out already ran there
  // and is not recomputed here — and tombstone the whole set up front in
  // `prerendered_html_pending` (the `prerendered_html` analog of
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
  // `prerendered_html_pending`. The prerenderHtmlOnly counterpart of
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
    // A prerenderHtmlOnly batch has no index half, so each rendering takes
    // its own position in this job's write order.
    await this.writePrerenderedHtmlRow(
      url,
      entry,
      this.#positionOf(url, prerenderedRowType(entry)),
    );
  }

  // The prerendered_html row write shared by the two producers of renderings:
  // a `prerenderHtmlOnly` batch (via `updatePrerenderedHtmlEntry`) and a fused
  // batch (via `updateEntry`, which lands each visit's HTML half here inline).
  //
  // `seq` is this row's position in the batch's write order; the write-side
  // stamps built from it are merged over the render's own diagnostics, so a
  // rendering is groupable and orderable by the same two keys as an index
  // row (`invalidationId` + `writeSeq`). A `prerenderHtmlOnly` batch mints
  // its `invalidationId` in the constructor and never calls `invalidate()`,
  // so the id groups that whole job — it is the render channel's own
  // grouping key and does not equal the spawning index pass's id. Join the
  // two channels on `url` (plus `generation`), not on `invalidationId`.
  private async writePrerenderedHtmlRow(
    url: URL,
    entry: PrerenderedHtmlEntry | PrerenderedHtmlErrorEntry,
    seq: number,
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
    // Every rendering carries the stamps, whether or not the render itself
    // reported any diagnostics — an unstamped row could not be attributed to
    // a pass at all, which is what the render channel lacked.
    let rowType = prerenderedRowType(entry);
    let stampedFromIndexGeneration = this.#prerenderHtmlOnly
      ? this.#adoptedIndexGenerations().get(
          indexGenerationKey(url.href, rowType),
        )
      : undefined;
    let diagnostics: Diagnostics = {
      ...(entry.diagnostics ?? {}),
      ...this.#writeSideStamps(seq),
      // The live index row generation this row's stamp was read from. Absent
      // when the URL had no index row of this type to read, and the row took
      // the realm's committed generation instead.
      ...(stampedFromIndexGeneration !== undefined
        ? { stampedFromIndexGeneration }
        : {}),
    };
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
          diagnostics,
          screenshots: entry.screenshots ?? null,
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
        // diagnostics. The copy on `error_doc.diagnostics` is the read path
        // operator mode surfaces ("send error to AI assistant" renders the
        // blob verbatim), so it mirrors the entry's own diagnostics and adds
        // nothing: this pass's stamps are bookkeeping for the operator
        // queries rather than for that dialog. What the entry arrives with
        // differs by pipeline, and the mirror follows it — a split
        // pipeline's render entry carries render-produced fields only, while
        // a fused visit's entry is built from its index half's blob
        // (`prerenderedHtmlEntryFrom`) and so already has that row's stamps
        // merged in. Unlike the HTML columns below, neither copy is taken
        // from the last-known-good production row: both describe this
        // failing render.
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
        // Any preserved render is content worth keeping; `isolated_html` alone
        // is not the test, since a FileDef family may carry only markdown.
        let hasPriorRender = Boolean(
          production?.isolated_html ??
          production?.embedded_html ??
          production?.fitted_html ??
          production?.atom_html ??
          production?.head_html ??
          production?.markdown,
        );
        let withholdHtmlFailure =
          verdictCoversRow(diagnostics, type) && hasPriorRender;
        if (withholdHtmlFailure) {
          // Withholding keeps the prior render published and clears the error
          // that would otherwise have flagged the row — so nothing is left
          // asking for the re-render once the environment recovers. The
          // reconcile sweep picks these up instead, and this run length bounds
          // how long it keeps trying. Extend the prior row's run for whichever
          // verdict actually covers this row, so a cause that keeps recurring
          // converges on its own cap; a successful render replaces the row
          // outright and ends the run.
          let priorDiagnostics = production?.diagnostics as Diagnostics | null;
          if (verdictArrayCoversRow(diagnostics?.staleShellFailure, type)) {
            diagnostics = {
              ...diagnostics,
              staleShellFailureRenders:
                (priorDiagnostics?.staleShellFailureRenders ?? 0) + 1,
            };
          }
          if (verdictArrayCoversRow(diagnostics?.gatewayFailure, type)) {
            diagnostics = {
              ...diagnostics,
              gatewayFailureRenders:
                (priorDiagnostics?.gatewayFailureRenders ?? 0) + 1,
            };
          }
        }
        if (errorDoc.visitRequestFailure) {
          // Consecutive-failure bookkeeping for the reconcile sweep's
          // bounded retry lane: extend the prior row's run when it was also
          // a visit-request failure, otherwise this write starts a run of
          // one. A successful render ends the run by replacing the row
          // outright, so no explicit clear is needed.
          let priorRun = production?.error_doc?.visitRequestFailure
            ? (production.error_doc.consecutiveVisitFailures ?? 1)
            : 0;
          errorDoc.consecutiveVisitFailures = priorRun + 1;
        }
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
          // The same withholding as the index channel, and it has to be here
          // too: `effectiveHasError()` is
          // `COALESCE(i.has_error, FALSE) OR (ph.error_doc IS NOT NULL AND
          // ph.generation >= i.generation)`, so a current error on this channel
          // makes the row read as errored whatever `boxel_index` says — and
          // `effectiveErrorDoc()` then serves this column. Suppressing only the
          // index channel would leave the transient failure published on the
          // split path, which is the default on Postgres.
          //
          // Gated on prior HTML for the same reason the other channel gates on
          // `pristine_doc`: with nothing to fall back to, the failure has to
          // surface rather than leave the row blank.
          error_doc: withholdHtmlFailure ? null : errorDoc,
          diagnostics,
          // Like the HTML columns above: the manifest is a last-known-good
          // artifact — its objects still exist in the MediaCache and the
          // preserved HTML may reference them by name.
          screenshots: production?.screenshots ?? null,
        };
        break;
      }
      default:
        throw new Error(
          `Unsupported prerendered-html entry type: ${(entry as { type: string }).type}`,
        );
    }
    for (let key of ['deps', 'last_known_good_deps'] as const) {
      if (Array.isArray(payload[key])) {
        payload[key] = await this.internScopedCSSDeps(payload[key] as string[]);
      }
    }
    let payloadErrorDoc = payload.error_doc as SerializedError | null;
    if (payloadErrorDoc?.deps) {
      payloadErrorDoc.deps = await this.internScopedCSSDeps(
        payloadErrorDoc.deps,
      );
    }
    let preparedEntry = {
      url: url.href,
      file_alias: trimExecutableExtension(rri(url.href)).replace(/\.json$/, ''),
      realm_url: this.realmURL.href,
      generation: this.htmlRowGeneration(url.href, rowType),
      is_deleted: false,
      rendered_at: Date.now(),
      job_id: this.jobInfo?.jobId ?? null,
      ...payload,
      staging_id: this.#stagingId,
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
        'prerendered_html_pending',
        'prerendered_html_pending_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  // The declared-screenshot state the previous pass published for this URL's
  // rows, read from production `prerendered_html` in one query and keyed by
  // row type: the manifest is the carry-forward input for
  // `keyBy: 'file-content'` slots (skip re-rendering when the source bytes
  // are unchanged), and the recorded capture failures seed this pass's
  // consecutive-failure bookkeeping — per-slot runs (a slot that fails again
  // extends its run) plus the row-level failing-render counter the reconcile
  // sweep's bounded retry lane caps on. A row that doesn't exist has no key;
  // fields it carried nothing for are null.
  async priorScreenshotStates(
    url: URL,
  ): Promise<Partial<Record<'instance' | 'file', PriorScreenshotState>>> {
    // This runs once per visit, so it selects only what the two rows'
    // capture bookkeeping needs — the HTML columns are large and irrelevant
    // here.
    let rows = (await this.#query([
      `SELECT type, screenshots, diagnostics FROM prerendered_html WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        any([
          [`url =`, param(url.href)],
          [`file_alias =`, param(url.href)],
        ]),
        any([
          ['type =', param('instance')],
          ['type =', param('file')],
        ]),
      ]),
    ] as Expression)) as unknown as Pick<
      PrerenderedHtmlTable,
      'type' | 'screenshots' | 'diagnostics'
    >[];
    let states: Partial<Record<'instance' | 'file', PriorScreenshotState>> = {};
    for (let row of rows) {
      if (row.type !== 'instance' && row.type !== 'file') {
        continue;
      }
      let priorDiagnostics = row.diagnostics as Diagnostics | null;
      let priorErrors = priorDiagnostics?.screenshotErrors;
      let priorFailureRenders =
        priorDiagnostics?.screenshotCaptureFailureRenders;
      states[row.type] = {
        manifest: (row.screenshots as ScreenshotManifest | null) ?? null,
        screenshotErrors:
          Array.isArray(priorErrors) && priorErrors.length > 0
            ? priorErrors
            : null,
        captureFailureRenders:
          typeof priorFailureRenders === 'number' ? priorFailureRenders : null,
      };
    }
    return states;
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
  ): Promise<
    Map<string, { type: PrerenderedHtmlTable['type']; isDeleted: boolean }[]>
  > {
    if (invalidations.length === 0) {
      return new Map();
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    // One row per (url, type) — the table's primary key is
    // (url, realm_url, type) and the realm is pinned below.
    let rows = (await this.#query([
      'SELECT url, type, is_deleted FROM prerendered_html WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(uniqueInvalidations.map((id) => [param(id)])),
          ),
        ],
      ]),
    ] as Expression)) as Pick<
      PrerenderedHtmlTable,
      'url' | 'type' | 'is_deleted'
    >[];
    let typesByUrl = new Map<
      string,
      { type: PrerenderedHtmlTable['type']; isDeleted: boolean }[]
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

  async done(opts?: {
    // This batch rebuilt the whole realm rather than an incremental fan-out.
    // Recorded on the commit's ledger row.
    fullRealm?: true;
    // Checks the pass against the peer passes that committed while it ran,
    // and re-visits what they made stale before committing. Without it the
    // commit accounts for its peers only through the adoption chains
    // `recordPeerCommittedTypes` reads.
    validation?: CommitValidation;
  }): Promise<BatchDoneResult> {
    // Drain any rows the visit loop left buffered before the swap reads the
    // pending table. A no-op for a prerenderHtmlOnly batch (which never
    // buffers) and for a pass whose last write already forced a flush.
    await this.flushWriteBuffer();
    // Read outside the transaction: `getColumnNames` runs on the adapter, not
    // on the transaction's connection, so calling it inside would check out a
    // second pool connection while the first sits waiting.
    let columns = {
      boxelIndex: await this.#dbAdapter.getColumnNames('boxel_index'),
      prerenderedHtml: await this.#dbAdapter.getColumnNames('prerendered_html'),
    };
    if (this.#prerenderHtmlOnly) {
      // A prerenderHtmlOnly batch touches nothing but the prerendered_html
      // channel: no realm_meta, no realm_generations bump, no boxel_index
      // swap. The guarded swap makes an out-of-order (lower-generation)
      // zombie job a per-row no-op.
      // Its rows carry the stamps `adoptIndexGenerations` read, and it
      // commits under the realm generation read alongside them; it allocates
      // none of its own.
      this.#adoptedIndexGenerations();
      let commit = await this.#commit(async () => {
        this.#commitGenerationInTransaction = this.#provisionalGeneration;
        await this.promotePrerenderedHtmlPending(columns.prerenderedHtml, {
          monotonicGuard: true,
        });
        await this.stampTypeGenerations({
          // `prerendered_html` carries no adoption chain of its own, so the
          // types this swap published are read from the `boxel_index` rows
          // the same URLs hold. That read is the reason these watermarks live
          // in a table the write side maintains rather than being aggregated
          // per request: it is one query per batch, not one per search.
          types: await this.publishedHtmlTypes(),
          channels: { html: true },
          monotonicGuard: true,
        });
      });
      this.#committedGeneration = this.#provisionalGeneration;
      return {
        totalIndexEntries: this.#invalidations.size,
        ...commit,
        ...(await this.clearPendingRows()),
      };
    }
    if (opts?.fullRealm) {
      this.#fullRealm = true;
    }
    let validation = opts?.validation;
    let report: ValidationReport = {
      checked: false,
      validationMs: 0,
      validationRounds: 0,
      revisitCount: 0,
      extendCount: 0,
    };
    // Set by the attempt that commits; an attempt that rolls back and runs
    // again overwrites it.
    let commitLockWaitMs = 0;
    let commit: { swapAttempts: number; swapRetryMs: number } | undefined;
    while (!commit) {
      try {
        let stagedDeps = validation
          ? await this.#stagedDepsWhenPeersCommitted()
          : undefined;
        commit = await this.commitAttempt(
          columns,
          validation && { validation, stagedDeps },
          report,
          (ms) => {
            commitLockWaitMs = ms;
          },
        );
      } catch (e) {
        if (!(e instanceof PeerCommitConflict) || !validation) {
          throw e;
        }
        let roundStart = Date.now();
        let round = await this.#prepareRevisit(e.conflicts);
        this.#log.info(
          `${jobIdentity(this.jobInfo)} commit of ${this.realmURL.href} rolled back for ${e.conflicts.peerCommits} peer commit(s) through generation ${e.conflicts.generation}: ` +
            `re-visiting ${round.urls.length} URL(s) (${e.conflicts.revisit.length} of its own, extended to ${e.conflicts.extend.length} peer-committed) in round ${round.round} of ${COMMIT_VALIDATION_MAX_ROUNDS}`,
        );
        await validation.revisit(round);
        await this.flushWriteBuffer();
        report.validationMs += Date.now() - roundStart;
        report.validationRounds = round.round;
        report.revisitCount += round.urls.length;
        report.extendCount += e.conflicts.extend.length;
      }
    }
    this.#committedGeneration = this.commitGeneration;
    let cleanup = await this.clearPendingRows();

    let totalIndexEntries = await this.numberOfIndexEntries();
    let { checked, followUpJobId, ...validated } = report;
    return {
      totalIndexEntries,
      ...commit,
      commitLockWaitMs,
      ...(checked
        ? {
            ...validated,
            ...(followUpJobId !== undefined ? { followUpJobId } : {}),
          }
        : {}),
      ...cleanup,
    };
  }

  // One run of the commit's transaction. With `validation`, the first thing
  // it does under the commit lock is check the peer commits since the pass
  // last validated. Stale rows with rounds to spare throw `PeerCommitConflict`,
  // which rolls the transaction back having written nothing; with the rounds
  // spent the commit goes ahead and enqueues a follow-up for what is left.
  private async commitAttempt(
    columns: { boxelIndex: string[]; prerenderedHtml: string[] },
    check:
      | {
          validation: CommitValidation;
          // Read ahead of the lock (see `#stagedDepsWhenPeersCommitted`).
          stagedDeps: Map<string, string[]> | undefined;
        }
      | undefined,
    report: ValidationReport,
    onLockHeld: (commitLockWaitMs: number) => void,
  ): Promise<{ swapAttempts: number; swapRetryMs: number }> {
    let validation = check?.validation;
    return await this.#commit(async () => {
      // First, so every statement below stamps the generation this commit
      // takes, and so the rest of the swap runs with the realm's commits
      // serialized behind it.
      onLockHeld(await this.allocateCommitGeneration());
      let observedGeneration = this.commitGeneration - 1;
      let leftStale: string[] | undefined;
      if (validation && observedGeneration > this.#validatedGeneration) {
        let checkStart = Date.now();
        let conflicts = await this.#findPeerConflicts(
          observedGeneration,
          check?.stagedDeps,
        );
        report.checked = true;
        report.validationMs += Date.now() - checkStart;
        if (conflicts.revisit.length > 0 || conflicts.extend.length > 0) {
          if (this.#validationRound < COMMIT_VALIDATION_MAX_ROUNDS) {
            throw new PeerCommitConflict(conflicts);
          }
          leftStale = [
            ...new Set([...conflicts.revisit, ...conflicts.extend]),
          ].sort();
        }
      }
      if (observedGeneration > this.#baseGeneration) {
        await this.recordPeerCommittedTypes();
      }
      await this.applyBatchUpdates(columns);
      // After the swap, so the summary is computed from the rows this commit
      // published and the realm's other committed rows — never from another
      // pass's rows still staged in the pending table.
      await this.updateRealmMeta();
      await this.pruneObsoleteEntries();
      await this.stampTypeGenerations({
        types: this.touchedTypes,
        channels: { index: true, html: this.#publishedPrerenderedHtml },
        bumpAllTypes: !this.typeSetIsComplete,
      });
      if (validation && leftStale) {
        // Set on every run of the transaction, so a run that a deadlock
        // rolled back cannot leave the id of a job that no longer exists.
        report.followUpJobId = await this.#enqueueFollowUp(
          validation,
          leftStale,
        );
      }
      await this.recordCommit();
      await this.publishGeneration();
    });
  }

  // Backward validation of this pass against every peer commit since
  // `#validatedGeneration`, read under the commit lock so no further peer can
  // commit before this pass does. The `realm_index_commits` ledger names the
  // URLs each peer promoted. A peer row that lists none (a full-realm pass, or
  // one too wide to list), and a generation with no ledger row at all, read as
  // every URL in the realm.
  //
  // A peer's commit leaves this pass stale in two ways:
  //  - revisit: the peer committed a URL this pass also visited, or one that a
  //    row this pass staged depends on. This pass read those against what the
  //    peer has since replaced.
  //  - extend: the peer committed a row, outside this pass, that depends on a
  //    URL of this pass. The peer rendered it against that URL as it stood
  //    before this pass commits, so it needs visiting again once this pass
  //    has, and its dependents with it. A row that already depended on this
  //    pass's URLs when the pass began is in the pass's invalidation set, so
  //    what this finds is a dependency the peer's commit introduced.
  //
  // Both read `deps`, so neither sees a query-backed field whose results a
  // peer's commit moved: a query's matches are not recorded as dependencies.
  //
  // `stagedDeps` are this pass's own staged deps, read before the lock was
  // taken. They are read here instead when a peer committed after that read
  // and the pre-lock read found nothing to do.
  async #findPeerConflicts(
    generation: number,
    stagedDeps: Map<string, string[]> | undefined,
  ): Promise<PeerConflicts> {
    let [epochRow] = (await this.#query([
      'SELECT loader_epoch FROM realm_generations WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmGenerationsTable, 'loader_epoch'>[];
    let peers = (await this.#query([
      'SELECT generation, urls FROM realm_index_commits WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['generation >', param(this.#validatedGeneration)],
        ['generation <=', param(generation)],
      ]),
    ] as Expression)) as Pick<RealmIndexCommitsTable, 'generation' | 'urls'>[];
    let peerCommits = generation - this.#validatedGeneration;
    let everyURL =
      peers.length < peerCommits || peers.some(({ urls }) => urls == null);
    let peerURLs = new Set(peers.flatMap(({ urls }) => urls ?? []));
    let ours = [...this.#invalidations];
    let oursSet = new Set(ours);

    let revisit: Set<string>;
    if (everyURL) {
      revisit = new Set(ours);
    } else {
      revisit = new Set(ours.filter((url) => peerURLs.has(url)));
      let peerForms = new Set(this.#dependencyForms(peerURLs));
      for (let [url, deps] of stagedDeps ?? (await this.#readStagedDeps())) {
        if (oursSet.has(url) && deps.some((dep) => peerForms.has(dep))) {
          revisit.add(url);
        }
      }
    }

    let extend = new Set<string>();
    let candidates = everyURL
      ? undefined
      : [...peerURLs].filter((url) => !oursSet.has(url));
    if (candidates === undefined || candidates.length > 0) {
      for (let url of await this.#productionDependents(
        this.#dependencyForms(ours),
        candidates,
      )) {
        if (!oursSet.has(url)) {
          extend.add(url);
        }
      }
    }

    return {
      generation,
      loaderEpoch: epochRow?.loader_epoch ?? '0',
      peerCommits,
      revisit: [...revisit].sort(),
      extend: [...extend].sort(),
    };
  }

  // Every form a row's `deps` can name one of `urls` in: the URL, the
  // extension-less form a module dependency is stored in, and the
  // registered-prefix spelling of either — the same forms the invalidation
  // fan-out matches (see `itemsThatReference`).
  #dependencyForms(urls: Iterable<string>): string[] {
    let forms = new Set<string>();
    for (let url of urls) {
      for (let form of [url, trimExecutableExtension(rri(url))]) {
        forms.add(form);
        let unresolved = this.unresolveURL(form);
        if (unresolved !== form && this.isRegisteredPrefix(unresolved)) {
          forms.add(unresolved);
        }
      }
    }
    return [...forms];
  }

  // This pass's staged `deps` by URL, for a commit whose check will need
  // them: one run when a peer has committed since the pass last validated,
  // and nothing otherwise, so a pass no peer overlapped reads nothing more.
  // Read before the commit lock is taken. The pass writes nothing more before
  // it commits, so the rows cannot move under the check, and a read the size
  // of the pass stays out of the time the realm's commits wait on the lock.
  async #stagedDepsWhenPeersCommitted(): Promise<
    Map<string, string[]> | undefined
  > {
    let [row] = (await this.#query([
      'SELECT current_generation FROM realm_generations WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmGenerationsTable, 'current_generation'>[];
    if (!row || Number(row.current_generation) <= this.#validatedGeneration) {
      return undefined;
    }
    return await this.#readStagedDeps();
  }

  // The `deps` of every live row this pass has staged, by URL, across the
  // channels it writes: the index channel, and on the fused path the HTML
  // channel too.
  async #readStagedDeps(): Promise<Map<string, string[]>> {
    let staged = new Map<string, string[]>();
    for (let table of this.#splitPrerenderHtml
      ? ['boxel_index_pending']
      : PENDING_TABLES) {
      let rows = (await this.#query([
        `SELECT url, deps FROM ${table} WHERE`,
        ...every([
          ['realm_url =', param(this.realmURL.href)],
          ['staging_id =', param(this.#stagingId)],
          any([['is_deleted = false'], ['is_deleted IS NULL']]),
          ['deps IS NOT NULL'],
        ]),
      ] as Expression)) as Pick<BoxelIndexTable, 'url' | 'deps'>[];
      for (let { url, deps } of rows) {
        staged.set(url, [...(staged.get(url) ?? []), ...(deps ?? [])]);
      }
    }
    return staged;
  }

  // The URLs of this realm's live production rows whose `deps` name any of
  // `depForms`, narrowed to `urls` when given. On Postgres the match is the
  // `?|` operator, which the GIN index on `boxel_index.deps` serves, so a
  // check that has to read the whole realm does not unnest every row's deps.
  async #productionDependents(
    depForms: string[],
    urls?: string[],
  ): Promise<Set<string>> {
    let found = new Set<string>();
    if (depForms.length === 0 || urls?.length === 0) {
      return found;
    }
    // Both lists bind one parameter per entry, so both are chunked to stay
    // within the budget `#upsertWithinBindBudget` keeps to.
    let bindBudget = this.#dbAdapter.kind === 'sqlite' ? 900 : 60000;
    let urlChunks: (string[] | undefined)[] = [undefined];
    if (urls) {
      urlChunks = [];
      let urlsPerQuery = Math.floor(bindBudget / 2);
      for (let i = 0; i < urls.length; i += urlsPerQuery) {
        urlChunks.push(urls.slice(i, i + urlsPerQuery));
      }
    }
    for (let urlChunk of urlChunks) {
      let formsPerQuery = bindBudget - (urlChunk?.length ?? 0) - 1;
      for (let i = 0; i < depForms.length; i += formsPerQuery) {
        let formParams = separatedByCommas(
          depForms.slice(i, i + formsPerQuery).map((form) => [param(form)]),
        ) as Expression;
        let rows = (await this.#query([
          dbExpression({
            pg: `SELECT i.url FROM boxel_index AS i WHERE`,
            sqlite: `SELECT DISTINCT i.url FROM boxel_index AS i CROSS JOIN json_each(i.deps) AS dep_entry WHERE`,
          }),
          ...every([
            ['i.realm_url =', param(this.realmURL.href)],
            any([['i.is_deleted = false'], ['i.is_deleted IS NULL']]),
            ...(urlChunk
              ? [
                  [
                    'i.url IN',
                    ...addExplicitParens(
                      separatedByCommas(urlChunk.map((url) => [param(url)])),
                    ),
                  ] as Expression,
                ]
              : []),
            [
              dbExpression({
                pg: ['i.deps ?| CAST(ARRAY[', ...formParams, '] AS text[])'],
                sqlite: [
                  'dep_entry.value IN',
                  ...addExplicitParens(formParams),
                ] as Expression,
              }),
            ],
          ]),
        ] as Expression)) as Pick<BoxelIndexTable, 'url'>[];
        for (let { url } of rows) {
          found.add(url);
        }
      }
    }
    return found;
  }

  // Readies the batch to re-visit what `conflicts` found. The pass extends to
  // the peer-committed URLs that depend on it, through the same fan-out
  // `invalidate()` runs. Every URL the round re-visits is put back in the
  // state `invalidate()` leaves a URL in, a tombstone over the row
  // production holds now, so a file a peer deleted stays deleted when the
  // re-visit finds nothing to read. And the batch takes up any loader epoch
  // minted since it read one.
  async #prepareRevisit(
    conflicts: PeerConflicts,
  ): Promise<CommitValidationRound> {
    this.#validationRound++;
    this.#validatedGeneration = conflicts.generation;
    let loaderEpochChanged = this.#adoptLoaderEpoch(conflicts.loaderEpoch);
    let staged = new Set(this.#invalidations);
    let renderOnly = new Set(this.#renderOnlyInvalidations);
    // Recomputed against the set as it stands, so the walk stops at URLs the
    // pass already holds instead of re-walking what its own fan-out reached.
    this.#nodeResolvedInvalidations = undefined;
    let extended =
      conflicts.extend.length > 0
        ? await this.#fanOut(conflicts.extend.map((url) => new URL(url)))
        : new Set<string>();
    let urls = [...new Set([...conflicts.revisit, ...extended])].sort();
    await this.#restageForRevisit(urls.filter((url) => staged.has(url)));
    return {
      round: this.#validationRound,
      urls,
      addedURLs: [...this.#invalidations].filter((url) => !staged.has(url)),
      addedRenderOnlyURLs: [...this.#renderOnlyInvalidations].filter(
        (url) => !renderOnly.has(url),
      ),
      loaderEpochChanged,
    };
  }

  // Takes up a loader epoch minted since this batch last read one, by a peer
  // pass's commit or a module write, and says whether it moved. A batch that
  // minted its own takes a fresh one instead: its renders ran under a token
  // issued before the modules the newer epoch covers changed, so a tab that
  // cleared for it can still hold those modules.
  #adoptLoaderEpoch(observed: string): boolean {
    if (observed === this.#priorLoaderEpoch) {
      return false;
    }
    this.#priorLoaderEpoch = observed;
    if (this.#mintedLoaderEpoch !== undefined) {
      this.#mintedLoaderEpoch = uuidv4();
    }
    return true;
  }

  // Drops what this batch staged for `urls` and tombstones them against
  // production afresh. The rows being replaced were read against state a peer
  // has since changed, including an earlier attempt's resumed rows, which
  // are no longer authoritative either.
  async #restageForRevisit(urls: string[]): Promise<void> {
    if (urls.length === 0) {
      return;
    }
    this.forgetResumedRows(urls);
    for (let url of urls) {
      this.#tombstonedLiveTypes.delete(url);
      this.#prerenderedHtmlTombstonedLiveTypes.delete(url);
    }
    let tables = this.#splitPrerenderHtml
      ? ['boxel_index_pending']
      : PENDING_TABLES;
    let bindBudget = this.#dbAdapter.kind === 'sqlite' ? 900 : 60000;
    let urlsPerDelete = bindBudget - 2;
    for (let table of tables) {
      for (let i = 0; i < urls.length; i += urlsPerDelete) {
        await this.#query([
          `DELETE FROM ${table} WHERE`,
          ...every([
            ['realm_url =', param(this.realmURL.href)],
            ['staging_id =', param(this.#stagingId)],
            [
              'url IN',
              ...addExplicitParens(
                separatedByCommas(
                  urls.slice(i, i + urlsPerDelete).map((url) => [param(url)]),
                ),
              ),
            ],
          ]),
        ] as Expression);
      }
    }
    await this.tombstoneEntries(urls);
  }

  // Enqueues, inside the commit's transaction, the `incremental-index` job
  // that re-indexes what the validation rounds left stale. It takes the lane,
  // priority and initiators of this pass's own job row, so it runs where the
  // pass would have and waits on behalf of the same writers. Because it is in
  // the commit's transaction, the job exists exactly when the commit does: a
  // commit that rolls back enqueues nothing, and one that lands cannot lose
  // its follow-up to a crash in between. A batch outside a job, or whose job
  // row is gone, takes the realm's index lane at the system tier.
  //
  // There is no job queue under SQLite, so there the commit goes ahead with
  // nothing enqueued, as it does when the pass gave no way to build the args.
  async #enqueueFollowUp(
    validation: CommitValidation,
    urls: string[],
  ): Promise<number | undefined> {
    if (this.#dbAdapter.kind !== 'pg' || !validation.followUpJobArgs) {
      this.#log.warn(
        `${jobIdentity(this.jobInfo)} commit of ${this.realmURL.href} is going ahead after ${COMMIT_VALIDATION_MAX_ROUNDS} validation rounds with ${urls.length} URL(s) still stale and no follow-up job to re-index them: ${urls.slice(0, 5).join(', ')}${urls.length > 5 ? ', …' : ''}`,
      );
      return undefined;
    }
    let args = JSON.stringify(validation.followUpJobArgs(urls));
    let rows: { id: number | string }[] = [];
    if (this.jobInfo && this.jobInfo.jobId > 0) {
      rows = (await this.#query([
        'INSERT INTO jobs (args, job_type, concurrency_group, priority, timeout, initiated_by)',
        'SELECT',
        ...separatedByCommas([
          ['CAST(', param(args), 'AS jsonb)'],
          ['CAST(', param('incremental-index'), 'AS varchar)'],
          ['j.concurrency_group'],
          ['j.priority'],
          ['CAST(', param(INCREMENTAL_INDEX_JOB_TIMEOUT_SEC), 'AS integer)'],
          ['j.initiated_by'],
        ]),
        'FROM jobs j WHERE j.id =',
        param(this.jobInfo.jobId),
        'RETURNING id',
      ] as Expression)) as { id: number | string }[];
    }
    if (rows.length === 0) {
      rows = (await this.#query([
        'INSERT INTO jobs (args, job_type, concurrency_group, priority, timeout) VALUES',
        ...addExplicitParens(
          separatedByCommas([
            ['CAST(', param(args), 'AS jsonb)'],
            [param('incremental-index')],
            [param(indexingConcurrencyGroup(this.realmURL.href))],
            [param(systemInitiatedIndexPriority(this.realmURL.href))],
            [param(INCREMENTAL_INDEX_JOB_TIMEOUT_SEC)],
          ]),
        ),
        'RETURNING id',
      ] as Expression)) as { id: number | string }[];
    }
    // Delivered when the transaction commits, so no worker looks for the job
    // before it exists.
    await this.#query(['NOTIFY jobs'] as Expression);
    let followUpJobId = Number(rows[0].id);
    this.#log.warn(
      `${jobIdentity(this.jobInfo)} commit of ${this.realmURL.href} is going ahead after ${COMMIT_VALIDATION_MAX_ROUNDS} validation rounds with ${urls.length} URL(s) still stale; enqueued follow-up job ${followUpJobId} to re-index them`,
    );
    return followUpJobId;
  }

  // Deletes the rows this batch staged, now that its commit has promoted
  // them, and then runs the janitor. Runs after the commit's transaction
  // rather than inside it, so the deletes add nothing to the time the realm's
  // commit lock is held — no other pass reads these rows, so there is nothing
  // for atomicity to protect. Best-effort for the same reason: the commit
  // already stands, and failing the job here would only rerun published
  // work. Rows a failure leaves behind are removed by the janitor of a later
  // commit to the realm, once this job is no longer running. Only this
  // attempt's staging is deleted: an earlier attempt's rows that it resumed
  // stay until the janitor clears them with the rest of its job's.
  private async clearPendingRows(): Promise<PendingCleanupResult> {
    let start = Date.now();
    try {
      for (let table of PENDING_TABLES) {
        await this.#query([
          `DELETE FROM ${table} WHERE`,
          ...every([
            ['realm_url =', param(this.realmURL.href)],
            ['staging_id =', param(this.#stagingId)],
          ]),
        ] as Expression);
      }
      let janitor = await this.clearOrphanedPendingRows();
      return { pendingCleanupMs: Date.now() - start, ...janitor };
    } catch (e) {
      this.#log.warn(
        `${jobIdentity(this.jobInfo)} could not clear pending rows staged under ${this.#stagingId} for ${this.realmURL.href} after its commit: ${(e as Error)?.message ?? String(e)}`,
      );
      return { pendingCleanupMs: Date.now() - start };
    }
  }

  // The janitor: removes this realm's pending rows that no pass can commit
  // any more, so no reader needs them.
  //  - A job's staging, once the job has resolved or rejected: the commit
  //    fence (`assertAttemptHoldsJob`) refuses any attempt of it that is still
  //    running. A job still `unfulfilled` keeps its attempts' rows, since its
  //    retry resumes from them. Rows whose job has no `jobs` row are left
  //    alone: nothing says that job has stopped. The queue is Postgres-only.
  //  - An ad-hoc staging (a batch outside a job) with no write for
  //    `ADHOC_STAGING_ABANDONED_MS`: a batch that died before its commit.
  //    Nothing records whether an ad-hoc batch is still running, so its last
  //    write is the only evidence, read from every column a write or
  //    tombstone stamps.
  private async clearOrphanedPendingRows(): Promise<{
    janitorRowsCleared: number;
    janitorStagingsCleared: number;
  }> {
    let abandoned = await this.abandonedAdhocStagings();
    let stagings = new Set<string>();
    let rows = 0;
    for (let table of PENDING_TABLES) {
      let orphaned: Expression[] = [];
      if (this.#dbAdapter.kind === 'pg') {
        orphaned.push([
          `EXISTS (SELECT 1 FROM jobs j WHERE j.id = ${table}.job_id AND j.status <> 'unfulfilled')`,
        ]);
      }
      if (abandoned.length > 0) {
        orphaned.push([
          'staging_id IN',
          ...addExplicitParens(
            separatedByCommas(abandoned.map((id) => [param(id)])),
          ),
        ] as Expression);
      }
      if (orphaned.length === 0) {
        continue;
      }
      let cleared = (await this.#query([
        // Unaliased: SQLite resolves no alias on the target of a DELETE.
        `DELETE FROM ${table} WHERE`,
        ...every([['realm_url =', param(this.realmURL.href)], any(orphaned)]),
        'RETURNING staging_id',
      ] as Expression)) as { staging_id: string }[];
      for (let { staging_id } of cleared) {
        stagings.add(staging_id);
        rows++;
      }
    }
    return { janitorRowsCleared: rows, janitorStagingsCleared: stagings.size };
  }

  // This realm's ad-hoc stagings whose last write, on either channel, is older
  // than `ADHOC_STAGING_ABANDONED_MS`.
  private async abandonedAdhocStagings(): Promise<string[]> {
    let threshold = Date.now() - ADHOC_STAGING_ABANDONED_MS;
    let lastWrite = (table: string, stamps: string[]) => [
      `SELECT staging_id, MAX(${dbGreatest(
        this.#dbAdapter.kind,
        stamps,
      )}) AS last_write FROM ${table} WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [`staging_id LIKE 'adhoc:%'`],
      ]),
      'GROUP BY staging_id',
    ];
    let indexedAtStamp = dbJsonNumber(
      this.#dbAdapter.kind,
      'diagnostics',
      'indexedAt',
    );
    let rows = (await this.#query([
      'SELECT staging_id FROM (',
      ...lastWrite('boxel_index_pending', ['indexed_at', indexedAtStamp]),
      'UNION ALL',
      ...lastWrite('prerendered_html_pending', ['rendered_at', indexedAtStamp]),
      ') AS writes GROUP BY staging_id HAVING MAX(last_write) <',
      param(threshold),
    ] as Expression)) as { staging_id: string }[];
    return rows.map(({ staging_id }) => staging_id);
  }

  // Runs `body` as one transaction, with every `#query` it makes sent through
  // the transaction's pinned querier. Readers therefore see all of a pass's
  // swap or none of it, and a failure part-way through leaves the realm
  // exactly as the previous pass published it.
  //
  // On Postgres, a deadlock with a concurrent commit rolls the whole body back
  // and runs it again (see `DBAdapter.withTransaction`). Re-running is safe
  // because everything the body changes is either undone by the rollback or
  // comes out the same on the next attempt:
  //  - its database writes, including the ones a copy batch makes to
  //    `prerendered_html_pending` and the media-cache ledger, roll back with
  //    the transaction;
  //  - its in-memory changes are idempotent: the copy adds the same URLs to
  //    the invalidation set, the loader-epoch getter returns the token it
  //    already minted, and `#publishedPrerenderedHtml` is set to the same
  //    value.
  //
  // The attempt count and the time spent on attempts that rolled back say how
  // often a deadlock forced a re-run. They do not measure lock waits: a swap
  // that waits on a concurrent commit's row locks without deadlocking still
  // commits on its first attempt. The wait for the realm's commit lock is
  // reported separately, as `commitLockWaitMs`; any other row-lock wait shows
  // up only in `swapMs`.
  async #commit(body: () => Promise<void>): Promise<{
    swapAttempts: number;
    swapRetryMs: number;
  }> {
    let swapAttempts = 0;
    let swapRetryMs = 0;
    let attemptStart = 0;
    await this.#dbAdapter.withTransaction(
      async (txQuerier) => {
        let now = Date.now();
        if (swapAttempts > 0) {
          swapRetryMs += now - attemptStart;
        }
        swapAttempts++;
        attemptStart = now;
        this.#txQuerier = txQuerier;
        try {
          await this.assertAttemptHoldsJob();
          await body();
        } finally {
          this.#txQuerier = undefined;
        }
      },
      { label: `the index swap of ${this.realmURL.href}` },
    );
    return { swapAttempts, swapRetryMs };
  }

  // Refuses the commit of an attempt that no longer holds its job. The queue
  // can let an attempt run on after it has lost the job — a deadline that
  // expires marks the job rejected without cancelling its handler, and a
  // lease that lapses lets another worker claim the job while the first
  // attempt is still running — and nothing may publish from such an attempt:
  // the janitor treats a finished job's staging as abandoned, and a
  // superseded attempt's retry has already resumed its work. The test is the
  // one `attemptJobFinalize` applies to a verdict: the job must still be
  // `unfulfilled`, this attempt's reservation open, and a lapsed lease not
  // already taken by a live one. Runs first in the swap's transaction, on
  // every attempt of it, and takes the job row `FOR SHARE`, so the queue
  // cannot finish the job or claim it again until the commit is over.
  //
  // Only a reservation that names its job is judged: without one (a batch
  // outside a job, or a caller passing an attempt the queue never made)
  // there is no attempt to have lost. SQLite has no job queue.
  private async assertAttemptHoldsJob(): Promise<void> {
    if (
      this.#dbAdapter.kind !== 'pg' ||
      !this.jobInfo ||
      this.jobInfo.jobId <= 0
    ) {
      return;
    }
    let { jobId, reservationId } = this.jobInfo;
    let [job] = (await this.#query([
      'SELECT status FROM jobs WHERE id =',
      param(jobId),
      'FOR SHARE',
    ] as Expression)) as { status: string }[];
    let [reservation] = (await this.#query([
      `SELECT completed_at IS NOT NULL AS closed, locked_until < NOW() AS expired,
              EXISTS (
                SELECT 1 FROM job_reservations other
                 WHERE other.job_id = r.job_id AND other.id <> r.id
                   AND other.completed_at IS NULL AND other.locked_until > NOW()
              ) AS reclaimed
         FROM job_reservations r WHERE`,
      ...every([
        ['r.id =', param(reservationId)],
        ['r.job_id =', param(jobId)],
      ]),
    ] as Expression)) as {
      closed: boolean;
      expired: boolean;
      reclaimed: boolean;
    }[];
    if (!job || !reservation) {
      return;
    }
    let lost =
      job.status !== 'unfulfilled'
        ? `the job is ${job.status}`
        : reservation.closed
          ? 'its reservation is closed'
          : reservation.expired && reservation.reclaimed
            ? 'its lease lapsed and another attempt holds the job'
            : undefined;
    if (lost) {
      throw new Error(
        `${jobIdentity(this.jobInfo)} no longer holds its job (${lost}), so its index pass of ${this.realmURL.href} does not commit`,
      );
    }
  }

  // The realm_meta value at the realm's current committed generation, or
  // undefined for a realm that has never completed a pass.
  //
  // Anchored on `realm_generations.current_generation` rather than on the
  // highest-numbered row, which a from-scratch reindex leaves behind — the
  // same JOIN the read side uses. Callers run inside done()'s transaction
  // before publishGeneration advances the generation, so this resolves the row
  // the pass is about to publish over.
  private async currentRealmMetaValue(): Promise<
    RealmMetaTable['value'] | undefined
  > {
    let [row] = (await this.#query([
      `SELECT rm.value
       FROM realm_meta rm
       JOIN realm_generations rg
         ON rg.realm_url = rm.realm_url
        AND rg.current_generation = rm.generation
       WHERE`,
      ...every([['rm.realm_url =', param(this.realmURL.href)]]),
      `LIMIT 1`,
    ] as Expression)) as unknown as { value: RealmMetaTable['value'] }[];
    return row?.value;
  }

  private async writeRealmMeta(value: RealmMetaTable['value']): Promise<void> {
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        realm_url: this.realmURL.href,
        generation: this.commitGeneration,
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

  #query(expression: Expression) {
    if (this.#txQuerier) {
      return this.#txQuerier(expression, coerceTypes);
    }
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
    let value =
      (await this.scopedRealmMetaValue()) ?? (await this.fullRealmMetaValue());
    await this.writeRealmMeta(value);
  }

  private async fullRealmMetaValue(): Promise<RealmMetaValue> {
    return {
      instances: await this.#fetchTypeSummary('instance'),
      files: await this.#fetchTypeSummary('file'),
    };
  }

  // The summary this pass publishes, built from the types it moved and the
  // previous generation's entries for everything else — or undefined when this
  // pass cannot be published that way and has to rebuild the whole summary.
  //
  // `typeSetIsComplete` is the condition that matters. It asks whether every
  // URL the swap promotes had its prior adoption chain read before the pass
  // wrote over it, which is exactly what makes `#touchedTypes` a complete
  // account of the groups whose counts could have moved. A row written without
  // that read can be leaving a type nothing else in the pass names, and this
  // path would carry that type's now-stale count forward as if it were still
  // current. Same polarity as the `bumpAllTypes` decision `done()` makes from
  // the same predicate: absence reads as "unknown", never as "unaffected".
  //
  // The prior value also has to be one a pass actually wrote, both arms and
  // all. A realm still holding the legacy shape has no `files` arm at all, and
  // reading it through `normalizeRealmMetaValue` would synthesize an empty one
  // that is indistinguishable from a realm with no file rows — carried forward,
  // that publishes the realm as having no file types. Rebuilding is what gives
  // such a realm its `files` arm, so it keeps rebuilding until it has one.
  //
  // The rest is cost, not correctness. A realm that has never completed a pass
  // has no prior entries to carry, and a pass that moved more types than the
  // scoped form is worth binding parameters for rebuilds instead.
  private async scopedRealmMetaValue(): Promise<RealmMetaValue | undefined> {
    if (!this.typeSetIsComplete) {
      return undefined;
    }
    let touchedTypes = this.touchedTypes;
    if (touchedTypes.length > SCOPED_TYPE_SUMMARY_MAX_TYPES) {
      return undefined;
    }
    let prior = await this.currentRealmMetaValue();
    if (!isPartitionedRealmMetaValue(prior)) {
      return undefined;
    }
    return {
      instances: await this.#fetchMergedTypeSummary(
        'instance',
        touchedTypes,
        prior.instances,
      ),
      files: await this.#fetchMergedTypeSummary(
        'file',
        touchedTypes,
        prior.files,
      ),
    };
  }

  // Aggregates per-type summaries (count, display name, code-ref key, icon)
  // for one kind of row in boxel_index — either CardDef instances or
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
  //
  // `count(i.url)` counts rows, not distinct URLs, because the two are the
  // same thing here: the table's primary key is `(url, realm_url, type)` and
  // this query fixes `realm_url` and `type`, so no URL can appear twice in a
  // group. Asking for the distinct count instead is not free — it makes the
  // aggregate order its whole input by `(types->>0, url)`, which under a
  // locale collation is the most expensive thing in the swap: both keys are
  // long URLs that share a per-realm prefix, so the comparison cannot use
  // abbreviated keys and runs at full length on every pair.
  async #fetchTypeSummary(
    indexType: BoxelIndexTable['type'],
  ): Promise<CardTypeSummary[]> {
    let results = await this.#query([
      ...this.#typeSummaryAggregate(indexType),
      TYPE_SUMMARY_ORDER_BY,
    ] as Expression);
    return results as unknown as CardTypeSummary[];
  }

  // The per-type aggregate itself, shared by both rollup paths and differing
  // only in which leaf types it covers — every type in the realm when
  // `leafTypes` is omitted, that set when it is given.
  //
  // One builder rather than two spellings of the same query: what a summary row
  // is — its columns, what counts as a live row — has to move on both paths at
  // once, or a realm's summary comes to depend on which path its last pass took,
  // with nothing raised and nothing red.
  #typeSummaryAggregate(
    indexType: BoxelIndexTable['type'],
    leafTypes?: string[],
  ): Expression {
    return [
      `SELECT CAST(count(i.url) AS INTEGER) as total, MAX(i.display_names->>0) as display_name, i.types->>0 as code_ref, MAX(i.icon_html) as icon_html
       FROM boxel_index as i
          WHERE`,
      ...every([
        ['i.realm_url =', param(this.realmURL.href)],
        ['i.type = ', param(indexType)],
        ['i.types IS NOT NULL'],
        leafTypes === undefined
          ? [
              dbExpression({
                pg: `(i.types->>0) IS NOT NULL`,
                sqlite: `json_extract(i.types, '$[0]') IS NOT NULL`,
              }),
            ]
          : [
              dbExpression({
                pg: `(i.types->>0)`,
                sqlite: `json_extract(i.types, '$[0]')`,
              }),
              `IN`,
              ...addExplicitParens(
                separatedByCommas(leafTypes.map((type) => [param(type)])),
              ),
            ],
        any([['i.is_deleted = false'], ['i.is_deleted IS NULL']]),
      ]),
      `GROUP BY i.types->>0`,
    ] as Expression;
  }

  // `#fetchTypeSummary` restricted to the types this pass moved, unioned with
  // the entries the previous generation already held for every other type.
  // Same result, without reading the whole realm's working set to produce it.
  //
  // The union and its ordering stay in SQL. `realm_meta.value` is ordered by
  // display name, and what that ordering means belongs to whichever adapter
  // holds the rows — a locale collation under Postgres, BINARY under SQLite.
  // Merging in JS would have to reproduce that to leave the order the sidebar
  // renders unchanged; letting the database order the merged set gives the same
  // array a full rebuild would, on each adapter, without naming a collation at
  // all. That holds entry for entry only because `TYPE_SUMMARY_ORDER_BY` is a
  // total order — ordering on display name alone would let this form and the
  // full rebuild disagree about tied entries, since this one would be breaking
  // those ties by which arm of the union a row came out of.
  //
  // The carried arm is filtered by the touched set rather than merged under
  // the recomputed one, so a type whose last row this pass removed — recomputed
  // to nothing, and therefore absent from both arms — drops out of the summary
  // instead of keeping its stale count.
  async #fetchMergedTypeSummary(
    indexType: BoxelIndexTable['type'],
    touchedTypes: string[],
    priorEntries: CardTypeSummary[],
  ): Promise<CardTypeSummary[]> {
    let touched = new Set(touchedTypes);
    let carried = priorEntries.filter((entry) => !touched.has(entry.code_ref));
    if (touched.size === 0) {
      // Nothing moved, so the previous generation's entries are already the
      // answer — and already in the order the database put them in.
      return carried;
    }
    let carriedJSON = JSON.stringify(carried);
    let results = await this.#query([
      `SELECT total, display_name, code_ref, icon_html FROM (`,
      ...this.#typeSummaryAggregate(indexType, [...touched]),
      `UNION ALL`,
      dbExpression({
        pg: [
          `SELECT p.total, p.display_name, p.code_ref, p.icon_html
           FROM jsonb_to_recordset(`,
          param(carriedJSON),
          `::jsonb) AS p(total integer, display_name text, code_ref text, icon_html text)`,
        ],
        sqlite: [
          `SELECT json_extract(p.value, '$.total') AS total,
                  json_extract(p.value, '$.display_name') AS display_name,
                  json_extract(p.value, '$.code_ref') AS code_ref,
                  json_extract(p.value, '$.icon_html') AS icon_html
           FROM json_each(`,
          param(carriedJSON),
          `) AS p`,
        ],
      }),
      `) AS summary`,
      TYPE_SUMMARY_ORDER_BY,
    ] as Expression);
    return results as unknown as CardTypeSummary[];
  }

  // The adoption chains production holds for this pass's URLs now, as a peer
  // pass that committed after this one was set up left them. The pre-pass
  // chains `#touchedTypes` already holds were read before that commit, so a
  // URL both passes wrote can be leaving a type the peer moved it into, which
  // nothing this pass read names. Read under the commit lock, before this
  // pass's rows replace the peer's, so the chains are the ones this commit is
  // about to write over. Only ever widens the set, so a re-run of the
  // transaction records the same types again.
  private async recordPeerCommittedTypes(): Promise<void> {
    let existingTypes = await this.existingIndexTypes([...this.#invalidations]);
    for (let entries of existingTypes.values()) {
      for (let { cardTypes } of entries) {
        this.#recordTouchedTypes(cardTypes);
      }
    }
  }

  // One `realm_index_commits` row per commit: which pass took the generation,
  // which URLs it published, and the committed generation it started from.
  // `urls` holds the rows the commit promoted and `render_only_urls` the
  // render-only dependents it restamped; between them they are every row the
  // commit moved to its generation. A full-realm pass, and a pass that moved
  // more rows than `INDEX_COMMIT_LEDGER_MAX_URLS`, lists neither — both read
  // as "every URL in the realm", which is the conservative answer for anyone
  // asking whether a commit could have touched a row. Rows past the retention
  // window are pruned from the realm's own ledger on the way.
  private async recordCommit(): Promise<void> {
    let now = Date.now();
    let listed =
      !this.#fullRealm &&
      this.#invalidations.size + this.#renderOnlyInvalidations.size <=
        INDEX_COMMIT_LEDGER_MAX_URLS;
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        realm_url: this.realmURL.href,
        generation: this.commitGeneration,
        base_generation: this.#baseGeneration,
        pass_id: this.#passId,
        job_id:
          this.jobInfo && this.jobInfo.jobId > 0 ? this.jobInfo.jobId : null,
        urls: listed ? [...this.#invalidations].sort() : null,
        render_only_urls: listed
          ? [...this.#renderOnlyInvalidations].sort()
          : null,
        full_realm: this.#fullRealm,
        committed_at: now,
      } as RealmIndexCommitsTable,
      { jsonFields: ['urls', 'render_only_urls'] },
    );
    await this.#query([
      ...upsert(
        'realm_index_commits',
        'realm_index_commits_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
    await this.#query([
      'DELETE FROM realm_index_commits WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['committed_at <', param(now - INDEX_COMMIT_LEDGER_RETENTION_MS)],
      ]),
    ] as Expression);
  }

  // Advances the realm to this batch's generation, and records the loader
  // epoch if this batch minted one. It is the swap's last statement: every
  // write to this row waits for the transaction that updated it to end, and a
  // user's module save writes it too (the write path mints a loader epoch
  // here), so issuing it last keeps the row locked for the commit alone rather
  // than for the whole swap. The statements before it read
  // `current_generation` without locking the row: to allocate this commit's
  // generation, under the commit lock, and to find the previous pass's
  // `realm_meta`, which is the value they need.
  private async publishGeneration() {
    // Reading the getter is what mints, so read it before asking whether it
    // did. `loader_epoch` joins the upsert only when this batch minted one:
    // the getter otherwise returns the token read at batch start, and writing
    // that back would clobber any epoch minted after this batch began —
    // including the one a concurrent module write minted for the definition
    // it invalidated, whose whole purpose is to be current for the populate
    // that follows the write rather than for the index pass. Omitted from the
    // insert too; a realm's first row takes the column's own '0' default,
    // which is the no-epoch-yet sentinel a fresh tab mismatches anyway.
    let loaderEpoch = this.loaderEpoch;
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: this.realmURL.href,
      current_generation: this.commitGeneration,
      ...(this.#mintedLoaderEpoch === undefined
        ? {}
        : { loader_epoch: loaderEpoch }),
    } as RealmGenerationsTable);
    await this.#query([
      ...upsert(
        'realm_generations',
        'realm_generations_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  private async applyBatchUpdates(columns: {
    boxelIndex: string[];
    prerenderedHtml: string[];
  }) {
    if (this.#invalidations.size > 0) {
      let columnExpressions = columns.boxelIndex.map((c) => [c]);
      let names = columns.boxelIndex;
      await this.#query([
        'INSERT INTO boxel_index',
        ...addExplicitParens(separatedByCommas(columnExpressions)),
        'SELECT',
        ...separatedByCommas(this.#restampedColumns(columns.boxelIndex)),
        'FROM boxel_index_pending',
        'WHERE',
        ...every([
          ['realm_url =', param(this.realmURL.href)],
          ['staging_id =', param(this.#stagingId)],
          any([['is_deleted = false'], ['is_deleted IS NULL']]),
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
      await this.#applyStagedTombstones({
        table: 'boxel_index',
        tombstoneColumns: INDEX_TOMBSTONE_COLUMNS,
        restamp: true,
      });

      // Publish this pass's `prerendered_html_pending` rows, UNLESS this is a
      // split-mode index pass — in which case HTML flows only through the
      // `prerender_html` job, this pass wrote nothing to the channel, and the
      // job's own swap publishes it. The fused path (SQLite) lands each
      // visit's HTML half in `prerendered_html_pending` via `updateEntry`
      // (tombstones via `tombstoneEntries`); a copy fills the channel from
      // the source realm's rows below.
      if (!this.#splitPrerenderHtml || this.#copyFromSourceRealm) {
        // For a copy, overlay the source realm's `prerendered_html` rows onto
        // this batch's pending rows. A destination URL whose source has
        // no `prerendered_html` row gets none either — it reads as unrendered
        // and the catch-up sweep enqueues its render.
        if (this.#copyFromSourceRealm) {
          await this.copyPrerenderedHtmlFrom(this.#copyFromSourceRealm);
        }

        // Swap the pending HTML rows into production in the same
        // transaction, keyed by the same staging id, invalidation set and
        // generation.
        await this.promotePrerenderedHtmlPending(columns.prerenderedHtml);
        this.#publishedPrerenderedHtml = true;
      }
    }

    await this.stampRenderOnlyEntries();
  }

  // The swap's SELECT list: every column as staged, except `generation`,
  // which takes this commit's. The pending rows carry the provisional
  // generation the pass anticipated at setup, which a peer that committed
  // first may have taken.
  #restampedColumns(columns: string[]): Expression[] {
    return columns.map((column) =>
      column === 'generation'
        ? ([
            'CAST(',
            param(this.commitGeneration),
            'AS INTEGER) AS generation',
          ] as Expression)
        : [column],
    );
  }

  // Render-only dependents keep their index row — its search document
  // cannot have moved — but two things keyed on that row must still see the
  // change. The card+json validator and response cache key on `indexed_at`,
  // and a card's `included` resources are assembled from its links at read
  // time, so a renderer that links the changed card would otherwise keep
  // serving the old linked resource under an unchanged ETag. And the
  // prerender-html reconcile sweep finds HTML to repair by
  // `prerendered_html.generation < boxel_index.generation`, so stamping this
  // pass's generation keeps a lost `prerender_html` job repairable, exactly
  // as it is for the rows this pass visits. One UPDATE stands in for the
  // visit the row no longer gets.
  private async stampRenderOnlyEntries() {
    if (this.#renderOnlyInvalidations.size === 0) {
      return;
    }
    let urls = [...this.#renderOnlyInvalidations];
    let indexedAt = Date.now();
    for (let offset = 0; offset < urls.length; offset += 5000) {
      await this.#query([
        'UPDATE boxel_index SET',
        ...separatedByCommas([
          ['indexed_at =', param(indexedAt)],
          ['generation =', param(this.commitGeneration)],
        ]),
        'WHERE',
        ...every([
          ['realm_url =', param(this.realmURL.href)],
          [
            'url IN',
            ...addExplicitParens(
              separatedByCommas(
                urls.slice(offset, offset + 5000).map((url) => [param(url)]),
              ),
            ),
          ],
          any([['is_deleted = false'], ['is_deleted IS NULL']]) as Expression,
        ]),
      ] as Expression);
    }
  }

  // Whether `#touchedTypes` is a complete account of what this pass moved.
  //
  // The swap promotes exactly `#invalidations`, and each of those rows
  // contributes two chains: the one it lands on, recorded by the write path,
  // and the one it held before, recorded only where `tombstoneEntries` read
  // production first. A row written without that read can be leaving a type
  // no other row in the pass names — a card that changes what it adopts from
  // is the plain case — so the departed type's watermark would stay put while
  // a search anchored on it still holds the card as a member.
  //
  // It is a property of the rows, not of which entry point ran: a pass can
  // call `invalidate()` for a deleted URL and then go on to write every file
  // in the realm, which is what a from-scratch rebuild does when nothing on
  // disk matches the index. A pass whose reads do not cover its writes moves
  // the catch-all key instead, so absence reads as "unknown".
  private get typeSetIsComplete(): boolean {
    for (let url of this.#invalidations) {
      if (!this.#preReadURLs.has(url)) {
        return false;
      }
    }
    return true;
  }

  // The card types this pass moved, stamped against the generation it
  // committed. A live search folds the watermarks of the types its filter is
  // anchored on into its cache key, so a write only unreaches the cached
  // searches it could have changed the membership of, rather than every
  // cached search in the realm.
  //
  // The two sides of this deliberately disagree, and that asymmetry is what
  // gives the key its selectivity. Here the *full adoption chain* of every
  // row the pass touched is stamped, so a `DailyReport` write moves
  // `DailyReport`, `CardDef`, and everything between. A reader resolves only
  // its own filter's spelling — never that spelling's ancestors — so a query
  // anchored on `Student` reads the `Student` watermark alone and survives
  // that write, while a write to a *subtype* of `Student` does move `Student`
  // and correctly invalidates it. Resolving ancestors on the read side
  // instead would put `CardDef` in every query's key, which every write
  // moves, and leave no selectivity at all.
  //
  // Only the channels the caller names are written; the other column keeps
  // whatever it holds. The index and HTML legs advance independently once
  // prerendering is split off the indexing pass, and a search reads both — it
  // excludes rows with an effective error, and a render error lands on the
  // HTML channel.
  private async stampTypeGenerations(args: {
    types: string[];
    channels: { index?: boolean; html?: boolean };
    // Also move the catch-all key, which every lookup folds in. For a pass
    // whose type set cannot be taken as complete: absence has to read as
    // "unknown", never as "unaffected".
    bumpAllTypes?: boolean;
    // Make a stale (lower-generation) stamp a per-row no-op, matching the
    // guard the `prerendered_html` swap it accompanies applies. Lowering a
    // watermark is sound — it moves the key, so readers recompute — but an
    // expired-reservation zombie job would otherwise churn every reader's
    // key on its way out. The predicate is built from the channels this call
    // writes, so it can never compare a column the statement is not setting.
    monotonicGuard?: boolean;
  }): Promise<void> {
    let channels: string[] = [];
    if (args.channels.index) {
      channels.push('index_generation');
    }
    if (args.channels.html) {
      channels.push('html_generation');
    }
    if (channels.length === 0) {
      return;
    }
    let columns: string[][] = [
      ['realm_url'],
      ['type_key'],
      ...channels.map((channel) => [channel]),
    ];
    let keys = new Set(args.types);
    if (args.bumpAllTypes) {
      keys.add(ALL_TYPES_KEY);
    }
    if (keys.size === 0) {
      return;
    }
    // A row absent from this table reads as generation 0, which is why the
    // channels the caller omits can be left to the column default on insert:
    // a type no pass has stamped on that channel cannot have moved on it.
    // Every channel column carries this batch's generation.
    //
    // Sorted so every commit that stamps this table locks its rows in the
    // same order. An index swap and a prerender-html swap of one realm run in
    // separate queue lanes and can commit at the same time; upserting
    // overlapping keys in different orders inside their transactions would
    // deadlock them.
    let rows = [...keys]
      .sort()
      .map((typeKey) => [
        [param(this.realmURL.href)],
        [param(typeKey)],
        ...channels.map(() => [param(this.commitGeneration)]),
      ]) as Expression[][];
    // Chunked so a realm with a large type vocabulary stays inside the
    // driver's bound-parameter ceiling.
    for (let offset = 0; offset < rows.length; offset += TYPE_STAMP_CHUNK) {
      await this.#query([
        ...upsertMultipleRows(
          'realm_type_generations',
          'realm_type_generations_pkey',
          columns,
          rows.slice(offset, offset + TYPE_STAMP_CHUNK),
        ),
        ...(args.monotonicGuard
          ? [
              `WHERE ${channels
                .map(
                  (channel) =>
                    `realm_type_generations.${channel} <= EXCLUDED.${channel}`,
                )
                .join(' AND ')}`,
            ]
          : []),
      ] as Expression);
    }
  }

  // The adoption chains behind the rows a `prerenderHtmlOnly` swap published.
  // Read from `boxel_index` because the HTML channel stores no chain of its
  // own, and from production rather than the pending table because the index
  // half of these URLs landed in an earlier pass.
  //
  // The distinct keys are extracted in SQL rather than by reading each row's
  // `types` array back and deduping here: the swap that follows a from-scratch
  // index covers every card in the realm, and this runs on the commit path, so
  // the payload has to be bounded by the realm's type vocabulary — the same
  // bound `TYPE_STAMP_CHUNK` asserts — and not by its row count. A
  // `prerenderHtmlOnly` batch is Postgres-only (SQLite fuses the two
  // channels), so the `jsonb` spelling is safe here.
  private async publishedHtmlTypes(): Promise<string[]> {
    let urls = [...new Set(this.#invalidations)];
    if (urls.length === 0) {
      return [];
    }
    let rows = (await this.#query([
      'SELECT DISTINCT jsonb_array_elements_text(types) AS type_key',
      'FROM boxel_index WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        // Only rows whose chain is actually an array. `jsonb_array_elements_text`
        // raises on anything else, and this runs inside the swap transaction —
        // a row holding a JSON `null` or a scalar would take the whole
        // publish down with it, and the HTML it was publishing with it. The
        // SQL-NULL case falls out of the same test, since `jsonb_typeof`
        // returns NULL there.
        [`jsonb_typeof(types) = 'array'`],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(urls.map((url) => [param(url)])),
          ),
        ],
      ]),
    ] as Expression)) as { type_key: string }[];
    return rows.map(({ type_key }) => type_key);
  }

  // Swap this batch's `prerendered_html_pending` rows into production
  // `prerendered_html`, keyed by its staging id and invalidation set: its live
  // rows are upserted, then its tombstones applied in place
  // (`#applyStagedTombstones`). `prerendered_html` has neither `job_id` nor
  // `staging_id`, so its column names (`columns`, read before the swap's
  // transaction opens) are the production projection and the SELECT drops
  // both from the pending row.
  //
  // A prerenderHtmlOnly batch passes `monotonicGuard: true`: the trailing
  // `WHERE prerendered_html.generation <= EXCLUDED.generation` makes a stale
  // (lower-generation) write a per-row no-op — the backstop against an
  // expired-reservation zombie job overwriting a newer pass's rows — while
  // keeping an equal-generation retry idempotent. It publishes the rows at the
  // generation they were staged under, which is the one its job carried.
  // Index/copy batches swap unguarded, restamping each row with the
  // generation their commit allocated: that generation is the realm's newest,
  // so the guard would always pass anyway.
  private async promotePrerenderedHtmlPending(
    columns: string[],
    opts?: {
      monotonicGuard?: boolean;
    },
  ): Promise<void> {
    if (this.#invalidations.size === 0) {
      return;
    }
    let prerenderedColumns = columns.map((c) => [c]);
    let prerenderedNames = columns;
    await this.#query([
      'INSERT INTO prerendered_html',
      ...addExplicitParens(separatedByCommas(prerenderedColumns)),
      'SELECT',
      ...separatedByCommas(
        opts?.monotonicGuard
          ? prerenderedColumns
          : this.#restampedColumns(prerenderedNames),
      ),
      'FROM prerendered_html_pending',
      'WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['staging_id =', param(this.#stagingId)],
        any([['is_deleted = false'], ['is_deleted IS NULL']]),
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
    await this.#applyStagedTombstones({
      table: 'prerendered_html',
      tombstoneColumns: HTML_TOMBSTONE_COLUMNS,
      restamp: !opts?.monotonicGuard,
      monotonicGuard: opts?.monotonicGuard,
    });
  }

  // The second half of a swap: this batch's staged tombstones, applied to the
  // production rows they delete. A staged tombstone carries only its
  // `tombstoneColumns`, so it is an in-place UPDATE of the row rather than a
  // copy — the row keeps the rest of its content, hidden by `is_deleted`. A
  // tombstone is only staged for a row production holds, so there is always
  // one to update; if another pass removed it first, there is nothing to
  // delete. `restamp` gives the rows this commit's generation, as the live
  // rows the swap promotes take it; otherwise each keeps the generation it was
  // staged under, and `monotonicGuard` skips a row production already holds
  // at a newer one, matching the guard on the swap's upsert.
  async #applyStagedTombstones(args: {
    table: 'boxel_index' | 'prerendered_html';
    tombstoneColumns: string[];
    restamp: boolean;
    monotonicGuard?: boolean;
  }): Promise<void> {
    let assignments = args.tombstoneColumns.map((column) =>
      column === 'generation' && args.restamp
        ? ([
            'generation = CAST(',
            param(this.commitGeneration),
            'AS INTEGER)',
          ] as Expression)
        : [`${column} = p.${column}`],
    );
    await this.#query([
      `UPDATE ${args.table} AS t SET`,
      ...separatedByCommas(assignments),
      `FROM ${args.table}_pending AS p`,
      'WHERE',
      ...every([
        ['p.realm_url =', param(this.realmURL.href)],
        ['p.staging_id =', param(this.#stagingId)],
        ['p.is_deleted = TRUE'],
        [
          'p.url IN',
          ...addExplicitParens(
            separatedByCommas([...this.#invalidations].map((i) => [param(i)])),
          ),
        ],
        ['t.realm_url = p.realm_url'],
        ['t.url = p.url'],
        ['t.type = p.type'],
        ...(args.monotonicGuard ? [['t.generation <= p.generation']] : []),
      ] as Expression[]),
    ] as Expression);
  }

  private async pruneObsoleteEntries() {
    // Delete every realm_meta row for this realm except the one this commit
    // just wrote. Cleaning by `!=` rather than `<` also sweeps rows numbered
    // above the current generation, which a realm whose generation counter
    // was ever reset can hold, and which would otherwise poison `_types`
    // reads when the SELECT picked the wrong one. The unique key on
    // (realm_url, generation) guarantees we never accidentally keep two
    // current rows.
    await this.#query([
      `DELETE FROM realm_meta`,
      'WHERE',
      ...every([
        ['generation !=', param(this.commitGeneration)],
        ['realm_url =', param(this.realmURL.href)],
      ]),
    ] as Expression);
  }

  // Records the committed state this pass starts from, and the provisional
  // generation it stages its rows under. The number the pass commits under is
  // allocated later, by `allocateCommitGeneration`.
  private async setNextGeneration() {
    let [row] = (await this.#query([
      'SELECT current_generation, loader_epoch FROM realm_generations WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmGenerationsTable, 'current_generation' | 'loader_epoch'>[];
    this.#priorLoaderEpoch = row?.loader_epoch ?? '0';
    if (!row) {
      // A peer pass can commit the realm's first generation between the read
      // above and this insert, so an existing row is left exactly as it is.
      await this.#query([
        'INSERT INTO realm_generations (realm_url, current_generation, loader_epoch) VALUES',
        ...(addExplicitParens(
          separatedByCommas([
            [param(this.realmURL.href)],
            [param(0)],
            [param('0')],
          ]),
        ) as Expression),
        'ON CONFLICT ON CONSTRAINT realm_generations_pkey DO NOTHING',
      ] as Expression);
    }
    this.#baseGeneration = row ? Number(row.current_generation) : 0;
    this.#validatedGeneration = this.#baseGeneration;
    this.#provisionalGeneration = this.#baseGeneration + 1;
  }

  // Allocates the generation this pass commits under: one past the realm's
  // committed `current_generation`, read while holding the realm's commit
  // lock. The lock serializes commits, not passes — two passes of one realm
  // can run side by side, and whichever commits second reads the first's
  // generation here and takes the next one — so `current_generation` only
  // ever advances, in commit order.
  //
  // The lock is a transaction-scoped advisory lock in a key space of its own
  // rather than a row lock on `realm_generations`: a user's module save writes
  // that row to mint a loader epoch, and a row lock taken here would hold that
  // save until the whole swap commits. The generation it guards has no other
  // writer — the loader-epoch mint leaves `current_generation` alone — so a
  // plain read under the lock is exact. SQLite runs every transaction on one
  // connection, so there is nothing to lock there.
  //
  // Returns the time spent waiting for the lock.
  private async allocateCommitGeneration(): Promise<number> {
    let lockStart = Date.now();
    if (this.#dbAdapter.kind === 'pg') {
      await this.#query([
        'SELECT pg_advisory_xact_lock(hashtextextended(',
        param(`${INDEX_COMMIT_LOCK_NAMESPACE}${this.realmURL.href}`),
        ', 0))',
      ] as Expression);
    }
    let commitLockWaitMs = Date.now() - lockStart;
    let [row] = (await this.#query([
      'SELECT current_generation FROM realm_generations WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmGenerationsTable, 'current_generation'>[];
    this.#commitGenerationInTransaction =
      (row ? Number(row.current_generation) : 0) + 1;
    return commitLockWaitMs;
  }

  private async tombstoneEntries(invalidations: string[]) {
    // insert tombstone into next version of the realm index. Stamp
    // the current `invalidationId` + `indexedAt` on every tombstone
    // so fan-out queries (`WHERE diagnostics->>'invalidationId'
    // = <id>`) also surface the delete rows for this pass — otherwise
    // tombstones would inherit a stale ID from a prior write or stay
    // NULL entirely, misattributing deletes in the grouping view.
    // No `writeSeq`: these land before the pass has visited anything, so
    // ordering them against the visit rows that overwrite them would say
    // nothing, and a URL the pass never visits (a deletion) is genuinely
    // absent from the visit order.
    //
    // Filter out URLs the previous attempt of this job already wrote
    // a real (non-tombstone) row for. Tombstoning would upsert over
    // that real content and erase the previous attempt's progress,
    // defeating the resume.
    let toTombstone = invalidations.filter(
      (url) => !this.#resumedRows.has(url),
    );
    // Read over every invalidated URL, not just the ones being tombstoned:
    // the pre-pass adoption chain is what a live query anchored on the type a
    // row is leaving needs to hear about, and a resumed row is skipped below
    // while still being promoted by this attempt — so the attempt that
    // broadcasts is not always the one that tombstoned it.
    let existingTypes = await this.existingIndexTypes(invalidations);
    for (let entries of existingTypes.values()) {
      for (let { cardTypes } of entries) {
        this.#recordTouchedTypes(cardTypes);
      }
    }
    // Every URL read above now has its prior chain in `#touchedTypes`,
    // including the ones production holds no row for — those have no prior
    // chain to leave. This is the read `typeSetIsComplete` asks about.
    for (let url of invalidations) {
      this.#preReadURLs.add(url);
    }
    if (toTombstone.length === 0) {
      return;
    }
    for (let [url, entries] of existingTypes) {
      if (this.#resumedRows.has(url)) {
        continue;
      }
      let liveTypes = entries
        .filter((entry) => !entry.isDeleted)
        .map((entry) => entry.type);
      if (liveTypes.length > 0) {
        this.#tombstonedLiveTypes.set(url, liveTypes);
      }
    }
    // A staged tombstone carries only these columns. The swap applies it to
    // the production row in place (`applyBatchUpdates`), so the rest of the
    // row — its document, deps and types — stays as production holds it,
    // hidden by `is_deleted`, which is what the last-known-good carry-forwards
    // read if the file comes back. `has_error` and `error_doc` are listed
    // with explicit false / null so the deletion clears any error state, both
    // on the production row and on a row this staging already holds for the
    // URL, whose other columns an ON CONFLICT upsert would otherwise keep.
    let columns = [
      'url',
      ...INDEX_TOMBSTONE_COLUMNS,
      'type',
      'realm_url',
      'job_id',
      'staging_id',
    ].map((c) => [c]);
    let tombstoneDiagnostics: Diagnostics = {
      invalidationId: this.#currentInvalidationId,
      passId: this.#passId,
      indexedAt: Date.now(),
      ...this.#validationRoundStamp(),
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
          // doesn't swap the row's alias to a `.json`-suffixed variant that
          // alias-keyed lookups (`urlsMatchingSeed*`) miss.
          trimExecutableExtension(rri(id)).replace(/\.json$/, ''),
          this.#provisionalGeneration,
          true, // is_deleted
          false, // has_error — explicit clear so stale error state from
          // a prior pass does not survive the deletion
          null, // error_doc — same rationale
          tombstoneDiagnosticsJson,
          type,
          this.realmURL.href,
          jobIdValue,
          this.#stagingId,
        ].map((v) => [param(v)]),
      );
    });

    if (rows.length === 0) {
      return;
    }

    await this.#upsertWithinBindBudget(
      'boxel_index_pending',
      'boxel_index_pending_pkey',
      columns,
      rows,
    );

    // On the fused path this batch owns the prerendered_html channel too, so
    // the deletion must tombstone both. (A split-mode batch leaves the
    // channel to its spawned `prerender_html` job, whose
    // `seedPrerenderedHtmlInvalidations` tombstones it.)
    if (!this.#splitPrerenderHtml) {
      await this.tombstonePrerenderedHtmlEntries(toTombstone);
    }
  }

  // Tombstone the prerendered_html channel for the given URLs — the
  // `prerendered_html_pending` analog of `tombstoneEntries`, written by a
  // prerenderHtmlOnly batch's seeding and by a fused batch alongside its
  // boxel_index tombstones. Only URLs with existing prerendered_html rows
  // get one (there is no rendering to hide otherwise), and the tombstone
  // clears any prior render error / diagnostics. The visit loop's writes
  // overwrite survivors, so only genuinely deleted URLs stay tombstoned
  // through the swap.
  // One multi-row upsert binds `rows * columns` parameters, and every driver
  // caps what a single statement may carry — SQLite at ~999, Postgres at
  // 65,535. A realm-sized batch passes either ceiling, and the driver rejects
  // the whole statement, so the caller loses its entire pass rather than part
  // of it. Chunk against the same budget `#upsertIndexRows` uses.
  async #upsertWithinBindBudget(
    table: string,
    constraint: string,
    nameExpressions: string[][],
    valueExpressions: Expression[][],
  ): Promise<void> {
    let bindBudget = this.#dbAdapter.kind === 'sqlite' ? 900 : 60000;
    let rowsPerUpsert = Math.max(
      1,
      Math.floor(bindBudget / nameExpressions.length),
    );
    for (let i = 0; i < valueExpressions.length; i += rowsPerUpsert) {
      await this.#query([
        ...upsertMultipleRows(
          table,
          constraint,
          nameExpressions,
          valueExpressions.slice(i, i + rowsPerUpsert),
        ),
      ]);
    }
  }

  private async tombstonePrerenderedHtmlEntries(urls: string[]): Promise<void> {
    let existingTypes = await this.existingPrerenderedHtmlTypes(urls);
    for (let [url, entries] of existingTypes) {
      let liveTypes = entries
        .filter((entry) => !entry.isDeleted)
        .map((entry) => entry.type);
      if (liveTypes.length > 0) {
        this.#prerenderedHtmlTombstonedLiveTypes.set(url, liveTypes);
      }
    }
    // The HTML columns and the `screenshots` manifest are deliberately NOT
    // in this list: the swap applies the tombstone to the production row in
    // place (`promotePrerenderedHtmlPending`), so it leaves those artifacts
    // there (is_deleted hides them), matching how the HTML columns have
    // always behaved through delete/restore cycles.
    let columns = [
      'url',
      ...HTML_TOMBSTONE_COLUMNS,
      'type',
      'realm_url',
      'job_id',
      'staging_id',
    ].map((c) => [c]);
    let now = Date.now();
    let jobIdValue = this.jobInfo?.jobId ?? null;
    let rows = urls.flatMap((id) => {
      let types = existingTypes.get(id);
      if (!types || types.length === 0) {
        return [];
      }
      return types.map(({ type }) =>
        [
          id,
          // The same file_alias form the live prerendered_html writes use, so
          // alias-keyed consumers (e.g. the itemsThatReference deps scan) see
          // one alias per URL whether the row is live or tombstoned.
          trimExecutableExtension(rri(id)).replace(/\.json$/, ''),
          this.htmlRowGeneration(id, type),
          true, // is_deleted
          null, // error_doc — a tombstone clears any prior render error
          null, // diagnostics — likewise cleared; they described the render this tombstone hides
          now, // rendered_at
          type,
          this.realmURL.href,
          jobIdValue,
          this.#stagingId,
        ].map((v) => [param(v)]),
      );
    });
    if (rows.length === 0) {
      return;
    }
    await this.#upsertWithinBindBudget(
      'prerendered_html_pending',
      'prerendered_html_pending_pkey',
      columns,
      rows,
    );
  }

  // Each invalidated URL's rows as the production index still holds them:
  // the row type (`instance` / `file`) and whether it is already a tombstone,
  // plus `cardTypes` — the row's adoption chain, which is the pre-pass half of
  // `#touchedTypes`.
  private async existingIndexTypes(
    invalidations: string[],
  ): Promise<Map<string, ExistingIndexRowType[]>> {
    if (invalidations.length === 0) {
      return new Map();
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    // One row per (url, type) — the table's primary key is
    // (url, realm_url, type) and the realm is pinned below.
    let rows = (await this.#query([
      'SELECT url, type, is_deleted, types FROM boxel_index WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(uniqueInvalidations.map((id) => [param(id)])),
          ),
        ],
      ]),
    ] as Expression)) as Pick<
      BoxelIndexTable,
      'url' | 'type' | 'is_deleted' | 'types'
    >[];
    let typesByUrl = new Map<string, ExistingIndexRowType[]>();
    for (let row of rows) {
      let entry = {
        type: row.type,
        isDeleted: Boolean(row.is_deleted),
        cardTypes: row.types,
      };
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
      `SELECT DISTINCT url FROM boxel_index_pending WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['staging_id =', param(this.#stagingId)],
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
    // Drain anything still buffered under the OUTGOING correlation ID before
    // rotating it. `#prepareIndexRow` reads the ID at flush time, so a row
    // buffered before this call and flushed after it would be filed under the
    // new fan-out while carrying the old one's write sequence — attributed to
    // a change it had nothing to do with. A no-op on the production path,
    // where `invalidate()` runs once per batch before any visit.
    await this.flushWriteBuffer();
    // Mint a fresh correlation ID for this invalidation fan-out; every
    // subsequent `updateEntry` on this batch stamps it into the row's
    // `diagnostics` so operators can group the rows touched by
    // the same triggering change. The write sequence restarts with it — and
    // the positions rows have already taken are dropped — so `writeSeq` is
    // 0-based within each `invalidationId` rather than within the batch's
    // lifetime.
    this.#currentInvalidationId = uuidv4();
    this.#writeSeq = 0;
    this.#writePositions.clear();
    await this.#fanOut(urls);
  }

  // Adds `urls` and everything that depends on them to the pass, tombstoning
  // each, and returns every URL the walk put in the index visit, including
  // any the pass already held. `invalidate()` runs it for the pass's
  // triggering change. A validation round runs it for the peer-committed URLs
  // the pass extends to, under the existing correlation id, because that
  // round continues the same pass.
  async #fanOut(urls: URL[]): Promise<Set<string>> {
    let start = Date.now();
    this.#perfLog.debug(
      `${jobIdentity} starting invalidation of ${urls.map((u) => u.href).join()}`,
    );
    // The index pass visits what the change reaches through index edges
    // alone. On the split path the full closure — index and render edges
    // together — is walked as well, and whatever it adds is left to the
    // `prerender_html` job. The fused path renders inline, so its visits must
    // cover every renderer: there the index walk follows both edge kinds and
    // there is no second walk. Both walks share one reference scan per path.
    let fanOut: FanOutWalk = {
      references: new Map(),
      followRenderEdges: !this.#splitPrerenderHtml,
      visited: new Set(),
    };
    let renderFanOut: FanOutWalk | undefined = this.#splitPrerenderHtml
      ? {
          references: fanOut.references,
          followRenderEdges: true,
          visited: new Set(),
        }
      : undefined;
    let invalidations = new Set<string>();
    let renderInvalidations = new Set<string>();
    for (let url of urls) {
      for (let seed of await this.invalidationSeeds(url)) {
        let alias = trimExecutableExtension(rri(seed));
        if (!this.nodeResolvedInvalidations.includes(alias)) {
          invalidations.add(seed);
        }
        if (!alias) {
          continue;
        }
        for (let dependent of await this.calculateInvalidations(
          alias,
          fanOut,
        )) {
          invalidations.add(dependent);
        }
        if (renderFanOut) {
          for (let dependent of await this.calculateInvalidations(
            alias,
            renderFanOut,
          )) {
            renderInvalidations.add(dependent);
          }
        }
      }
    }
    for (let url of renderInvalidations) {
      if (!invalidations.has(url) && !this.#invalidations.has(url)) {
        this.#renderOnlyInvalidations.add(url);
      }
    }
    for (let url of invalidations) {
      this.#renderOnlyInvalidations.delete(url);
    }

    if (invalidations.size === 0) {
      return invalidations;
    }

    let insertStart = Date.now();
    await this.tombstoneEntries([...invalidations]);

    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} inserted invalidated rows for  ${urls.map((u) => u.href).join()} in ${
        Date.now() - insertStart
      } ms`,
    );

    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} completed invalidation of ${urls.map((u) => u.href).join()} in ${Date.now() - start} ms (${invalidations.size} to visit, ${this.#renderOnlyInvalidations.size} render-only)`,
    );

    this.#invalidations = new Set([...this.#invalidations, ...invalidations]);
    return invalidations;
  }

  // Returns the minimum projection (url, type, deps) needed to order
  // invalidations by dependency. Server-side selection picks one row per
  // (url, type) with priority: this pass's staged non-deleted row >
  // production > this pass's staged tombstone, applied via a window function
  // over UNION ALL of both tables. Avoids the
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
      'FROM boxel_index_pending WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['staging_id =', param(this.#stagingId)],
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
    let pendingRows: DependencyIndexRow[] = [];
    let productionRows: DependencyIndexRow[] = [];
    for (let i = 0; i < uniqueUrls.length; i += urlBatchSize) {
      let urlBatch = uniqueUrls.slice(i, i + urlBatchSize);
      let [pendingBatchRows, productionBatchRows] = await Promise.all([
        this.queryDependencyRows('boxel_index_pending', urlBatch),
        this.queryDependencyRows('boxel_index', urlBatch),
      ]);
      pendingRows.push(...pendingBatchRows);
      productionRows.push(...productionBatchRows);
    }

    let rowsByKey = new Map<
      string,
      {
        pending?: DependencyIndexRow;
        production?: DependencyIndexRow;
      }
    >();

    for (let row of pendingRows) {
      let key = `${row.url}|${row.type}`;
      let existing = rowsByKey.get(key) ?? {};
      existing.pending = row;
      rowsByKey.set(key, existing);
    }

    for (let row of productionRows) {
      let key = `${row.url}|${row.type}`;
      let existing = rowsByKey.get(key) ?? {};
      existing.production = row;
      rowsByKey.set(key, existing);
    }

    let selectedRows: DependencyIndexRow[] = [];
    for (let { pending, production } of rowsByKey.values()) {
      if (pending && !pending.isDeleted) {
        selectedRows.push(pending);
        continue;
      }
      if (pending?.isDeleted && production) {
        selectedRows.push(production);
        continue;
      }
      if (pending) {
        selectedRows.push(pending);
        continue;
      }
      if (production) {
        selectedRows.push(production);
      }
    }

    return selectedRows;
  }

  // `boxel_index_pending` is read only for this pass's own staged rows.
  private async queryDependencyRows(
    tableName: 'boxel_index' | 'boxel_index_pending',
    urls: string[],
  ): Promise<DependencyIndexRow[]> {
    if (urls.length === 0) {
      return [];
    }

    let rows = (await this.#query([
      `SELECT url, type, deps, has_error, is_deleted, error_doc FROM ${tableName} WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ...(tableName === 'boxel_index_pending'
          ? [['staging_id =', param(this.#stagingId)] as Expression]
          : []),
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

  private async itemsThatReference(
    resolvedPath: string,
  ): Promise<ReferencingItem[]> {
    let start = Date.now();
    const pageSize = 1000;
    // Also search for the prefix form of the path (e.g. @cardstack/catalog/...)
    // since deps may be stored in prefix form for portability
    let unresolvedPath = this.unresolveURL(resolvedPath);
    let searchBothForms =
      unresolvedPath !== resolvedPath &&
      this.isRegisteredPrefix(unresolvedPath);
    let scanTable = async (
      tableName: 'boxel_index_pending' | 'prerendered_html' | 'boxel_index',
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
            ...(tableName === 'boxel_index_pending'
              ? [['i.staging_id =', param(this.#stagingId)] as Expression]
              : []),
            // A promoted tombstone is a deleted file — it has nothing to
            // re-render, and pulling it into the fan-out would visit a path
            // with no backing file. The pending and prerendered scans can
            // carry tombstones too — the pending scan only this pass's own,
            // for URLs already in its invalidation set — and the visit's
            // skip logic handles them, so only the production scan filters.
            ...(tableName === 'boxel_index'
              ? [
                  any([
                    ['i.is_deleted = false'],
                    ['i.is_deleted IS NULL'],
                  ]) as Expression,
                ]
              : []),
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
    // The reference graph spans both channels: `boxel_index.deps` carries
    // the index visit's edges (the search-doc walk), while
    // `prerendered_html.deps` carries edges only the format renders discover
    // — a rendered non-searchable link, the scoped-CSS artifacts of linked
    // instances. Both edge sets must feed the fan-out or a change to a
    // render-only dependency would never re-render its consumers. Each item
    // says which kind of edge found it, so the caller can keep render-only
    // consumers out of the index visit (see `calculateInvalidations`).
    //
    // This pass's own staged rows in `boxel_index_pending` are scanned as
    // well, so an edge the pass has written but not yet committed still
    // fans out. A peer pass's staged rows are not: until that pass commits,
    // its edges are not part of the index this pass is working from. Rows
    // present in both tables collapse in the (url, type) dedup below.
    let [pendingScan, prerenderedScan, productionScan] = await Promise.all([
      scanTable('boxel_index_pending'),
      scanTable('prerendered_html'),
      scanTable('boxel_index'),
    ]);
    let seen = new Set<string>();
    let results: ReferencingItem[] = [];
    for (let [rows, renderEdge] of [
      [pendingScan.results, false],
      [productionScan.results, false],
      [prerenderedScan.results, true],
    ] as const) {
      for (let { url, file_alias, type } of rows) {
        let key = `${url}|${type}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push({ url, alias: file_alias, type, renderEdge });
      }
    }
    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} time to determine items that reference ${resolvedPath} ${
        Date.now() - start
      } ms (page count=${
        pendingScan.pageNumber +
        prerenderedScan.pageNumber +
        productionScan.pageNumber
      })`,
    );
    return results;
  }

  // The dependents of `resolvedPath`, transitively, along the edges `walk`
  // follows. With `followRenderEdges` off, the walk stays on index edges: a
  // consumer found only through `prerendered_html.deps` is neither returned
  // nor recursed through, because nothing its index visit reads came from
  // the change. The reference scans are memoized on `walk.references`, which
  // the index walk and the full walk share.
  private async calculateInvalidations(
    resolvedPath: string,
    walk: FanOutWalk,
  ): Promise<string[]> {
    if (
      walk.visited.has(resolvedPath) ||
      this.nodeResolvedInvalidations.includes(rri(resolvedPath))
    ) {
      return [];
    }
    walk.visited.add(resolvedPath);
    let scan = walk.references.get(resolvedPath);
    if (!scan) {
      scan = this.itemsThatReference(resolvedPath);
      walk.references.set(resolvedPath, scan);
    }
    let items = (await scan).filter(
      ({ renderEdge }) => walk.followRenderEdges || !renderEdge,
    );
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
            .map((a) => this.calculateInvalidations(a, walk)),
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

  // Rewrite inline scoped-CSS deps (the `glimmer-scoped-css` form that
  // base64-embeds the entire stylesheet in the URL) to their hashed form,
  // interning the CSS bytes into the content-addressed `scoped_css` table.
  // The stylesheet text was by far the largest share of `deps` storage; the
  // hashed form keeps the dependency identity (and the realm's ability to
  // serve the stylesheet — by hash lookup) without carrying the bytes in
  // every referencing row. Non-scoped-CSS deps, already-hashed deps, and
  // unparseable entries pass through verbatim.
  private async internScopedCSSDeps(deps: string[]): Promise<string[]> {
    let toInsert: { hash: string; css: string }[] = [];
    let rewritten = deps.map((dep) => {
      if (
        typeof dep !== 'string' ||
        !isScopedCSSRequest(dep) ||
        isHashedScopedCSSRequest(dep)
      ) {
        return dep;
      }
      let parsed: ReturnType<typeof parseScopedCSSRequest>;
      try {
        parsed = parseScopedCSSRequest(dep);
      } catch (_err) {
        return dep;
      }
      if (parsed.form !== 'inline') {
        return dep;
      }
      let hash = md5(parsed.css);
      if (!this.#internedScopedCSSHashes.has(hash)) {
        this.#internedScopedCSSHashes.add(hash);
        toInsert.push({ hash, css: parsed.css });
      }
      return encodeHashedScopedCSSRequest(parsed.fromFile, hash);
    });
    // Modest chunks: each value carries a whole stylesheet, and a from-scratch
    // pass interns at most one row per distinct stylesheet in the realm.
    // The upsert refreshing `last_interned_at` on conflict is load-bearing:
    // the scheduled GC's grace window (see `sweepUnreferencedScopedCSS`)
    // relies on every intern — including one whose bytes were already
    // stored — marking the row recently touched, so a pass that re-interns a
    // currently-unreferenced row protects it until the pass promotes.
    const rowsPerUpsert = 20;
    for (let i = 0; i < toInsert.length; i += rowsPerUpsert) {
      let slice = toInsert.slice(i, i + rowsPerUpsert);
      let expressions = slice.map(({ hash, css }) =>
        asExpressions({
          realm_url: this.realmURL.href,
          hash,
          css,
          last_interned_at: Date.now(),
        }),
      );
      await this.#query([
        ...upsertMultipleRows(
          'scoped_css',
          'scoped_css_pkey',
          expressions[0].nameExpressions,
          expressions.map((e) => e.valueExpressions),
        ),
      ]);
    }
    return rewritten;
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

// The largest of `columns`, a NULL counting as 0, in the adapter's spelling.
function dbGreatest(kind: DBAdapter['kind'], columns: string[]): string {
  let values = columns.map((column) => `COALESCE(${column}, 0)`).join(', ');
  return kind === 'pg' ? `GREATEST(${values})` : `max(${values})`;
}

// A numeric field of a JSON column, in the adapter's spelling.
function dbJsonNumber(
  kind: DBAdapter['kind'],
  column: string,
  field: string,
): string {
  return kind === 'pg'
    ? `(${column}->>'${field}')::bigint`
    : `json_extract(${column}, '$.${field}')`;
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
// The `prerendered_html` row an entry writes to, error entries folded onto
// the row they preserve — the render channel's `rowType`.
function indexGenerationKey(url: string, type: string): string {
  return `${type} ${url}`;
}

function prerenderedRowType(
  entry: PrerenderedHtmlEntry | PrerenderedHtmlErrorEntry,
): BoxelIndexTable['type'] {
  switch (entry.type) {
    case 'instance-error':
      return 'instance';
    case 'file-error':
      return 'file';
    default:
      return entry.type;
  }
}

function rowType(entry: SearchIndexEntry): BoxelIndexTable['type'] {
  return isErrorEntry(entry) ? baseTypeFromError(entry) : entry.type;
}

// A `boxel_index_pending` row payload built but not yet upserted, plus the
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
