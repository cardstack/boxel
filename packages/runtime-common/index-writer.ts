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
  type RealmVersionsTable,
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
  ) {
    let batch = new Batch(this.#dbAdapter, realmURL, virtualNetwork, jobInfo);
    await batch.ready;
    return batch;
  }

  #query(expression: Expression) {
    return query(this.#dbAdapter, expression, coerceTypes);
  }

  async isNewIndex(realm: URL): Promise<boolean> {
    let [row] = (await this.#query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(realm.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
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
  #dbAdapter: DBAdapter;
  #perfLog = logger('index-perf');
  declare private realmVersion: number;
  private realmURL: URL; // this assumes that we only index cards in our own realm...
  private virtualNetwork: VirtualNetwork;
  private jobInfo?: JobInfo;

  constructor(
    dbAdapter: DBAdapter,
    realmURL: URL,
    virtualNetwork: VirtualNetwork,
    jobInfo?: JobInfo,
  ) {
    this.realmURL = realmURL;
    this.virtualNetwork = virtualNetwork;
    this.jobInfo = jobInfo;
    this.#dbAdapter = dbAdapter;
    this.#currentInvalidationId = uuidv4();
    this.ready = this.setupBatch();
  }

  private isRegisteredPrefix(reference: string): boolean {
    return this.virtualNetwork.isRegisteredPrefix(reference);
  }

  private unresolveURL(url: string): string {
    return this.virtualNetwork.unresolveURL(url);
  }

  private async setupBatch(): Promise<void> {
    await this.setNextRealmVersion();
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

  // Ensure a created_at row exists for this file in realm_file_meta and return it
  async ensureFileCreatedAt(localPath: string): Promise<number> {
    return ensureFileCreatedAt(this.#dbAdapter, this.realmURL.href, localPath);
  }

  // Look up the content hash and size persisted at write time for a given file
  // path, in a single row lookup. Either value is undefined when the realm has
  // no recorded value (e.g. files written before file-meta hashing existed, or
  // a no-op rewrite that left the columns untouched).
  async getContentMeta(localPath: string): Promise<{
    contentHash: string | undefined;
    contentSize: number | undefined;
  }> {
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
      entry.realm_version = this.realmVersion;
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
      entry.fitted_html = entry.fitted_html
        ? this.objectWithCopiedRealmKeys(sourceRealmURL, entry.fitted_html)
        : entry.fitted_html;
      entry.embedded_html = entry.embedded_html
        ? this.objectWithCopiedRealmKeys(sourceRealmURL, entry.embedded_html)
        : entry.embedded_html;
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
  }

  async updateEntry(url: URL, entry: SearchIndexEntry): Promise<void> {
    if (!new RealmPaths(this.realmURL, this.virtualNetwork).inRealm(url)) {
      // TODO this is a workaround for CS-6886. after we have solved that issue we can
      // drop this band-aid
      return;
    }
    // An instance-error / file-error entry whose `.error.message` is
    // empty would persist as a row with `has_error = true` and an
    // error_doc that is null or missing the human-readable text. Such
    // a row is invisible to UI and DB-only triage, and historically
    // produced indexing jobs that re-reserved indefinitely without
    // ever rejecting. Throw at the boundary so the caller's stderr log
    // carries the underlying render error and the worker can finalize
    // the reservation against the per-job cap instead of silently
    // writing a black-hole row.
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
    let href = url.href;
    this.#invalidations.add(url.href);
    // Build the per-row diagnostics blob. Render-side fields
    // come from the Prerenderer's `response.meta` (already flattened
    // in `visit-file.ts`); write-side stamps are added here:
    //
    //   - `invalidationId` — minted once per Batch (covers both
    //     incremental `invalidate()` calls and fromScratch), so every
    //     row from the same indexing pass shares a queryable
    //     correlation key.
    //   - `indexedAt` — wall-clock the write happened.
    //
    // The canonical storage is the `diagnostics` column. For
    // error rows we ALSO mirror the blob onto `error_doc.diagnostics`
    // so the UI read path (error doc → CardErrorJSONAPI.meta.
    // diagnostics via `formattedError`) keeps working unchanged —
    // no schema rename needed. The column remains source of truth;
    // the error-doc copy is derived.
    // Sanitize so jsonb-illegal bytes can't abort the batch on write.
    let diagnostics: Diagnostics = sanitizeForJsonb({
      ...(entry.diagnostics ?? {}),
      invalidationId: this.#currentInvalidationId,
      indexedAt: Date.now(),
    });
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
          isolated_html: entry.isolatedHtml,
          head_html: entry.headHtml ?? null,
          embedded_html: entry.embeddedHtml,
          fitted_html: entry.fittedHtml,
          atom_html: entry.atomHtml,
          icon_html: entry.iconHTML,
          markdown: entry.markdown ?? null,
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
          isolated_html: entry.isolatedHtml ?? null,
          head_html: entry.headHtml ?? null,
          embedded_html: entry.embeddedHtml ?? null,
          fitted_html: entry.fittedHtml ?? null,
          atom_html: entry.atomHtml ?? null,
          icon_html: entry.iconHTML ?? null,
          markdown: entry.markdown ?? null,
          last_modified: entry.lastModified,
          resource_created_at: entry.resourceCreatedAt,
          error_doc: null,
          has_error: false,
          diagnostics: diagnostics,
        };
        break;
      case 'instance-error':
      case 'file-error':
        entryPayload = {
          types: entry.types,
          search_doc: entry.searchData,
          // favor the last known good types over the types derived from the error state
          ...((await this.getProductionVersion(
            url,
            baseTypeFromError(entry),
          )) ?? {}),
          // preserve last_known_good_deps through error cycles (may have been cleared
          // by getProductionVersion if it returned undefined, so we explicitly preserve it)
          last_known_good_deps: await this.getLastKnownGoodDeps(
            url,
            baseTypeFromError(entry),
          ),
          type: baseTypeFromError(entry),
          error_doc: sanitizeForJsonb(errorEntry?.error ?? entry.error),
          has_error: true,
          diagnostics: diagnostics,
        };
        break;
      default:
        throw new Error(
          `Unsupported index entry type: ${(entry as { type: string }).type}`,
        );
    }
    let preparedEntry = {
      url: href,
      file_alias: trimExecutableExtension(rri(url.href)).replace(/\.json$/, ''),
      realm_version: this.realmVersion,
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
      preparedEntry.deps = preparedEntry.deps.map((d: string) =>
        this.unresolveURL(d),
      );
    }
    if (preparedEntry.last_known_good_deps) {
      preparedEntry.last_known_good_deps =
        preparedEntry.last_known_good_deps.map((d: string) =>
          this.unresolveURL(d),
        );
    }

    let { nameExpressions, valueExpressions } = asExpressions(preparedEntry, {
      jsonFields: [...Object.entries(coerceTypes)]
        .filter(([_, type]) => type === 'JSON')
        .map(([column]) => column),
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

  async done(): Promise<{ totalIndexEntries: number }> {
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
      realm_version: _remove4,
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
        realm_version: this.realmVersion,
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
      current_version: this.realmVersion,
    } as RealmVersionsTable);
    await this.#query([
      ...upsert(
        'realm_versions',
        'realm_versions_pkey',
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
    }
  }

  private async pruneObsoleteEntries() {
    // Delete every realm_meta row for this realm except the one we just
    // wrote. The previous predicate (`realm_version < this.realmVersion`)
    // only swept rows from incremental indexing where versions march
    // forward. A from-scratch reindex resets the version to a low number,
    // leaving older high-version rows orphaned forever — those legacy rows
    // then poisoned `_types` reads when the SELECT picked the wrong one.
    // Cleaning by `!=` covers both directions safely; the unique key on
    // (realm_url, realm_version) guarantees we never accidentally keep
    // two current rows.
    await this.#query([
      `DELETE FROM realm_meta`,
      'WHERE',
      ...every([
        ['realm_version !=', param(this.realmVersion)],
        ['realm_url =', param(this.realmURL.href)],
      ]),
    ] as Expression);
  }

  private async setNextRealmVersion() {
    let [row] = (await this.#query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      let { nameExpressions, valueExpressions } = asExpressions({
        realm_url: this.realmURL.href,
        current_version: 0,
      } as RealmVersionsTable);
      // Make the batch updates live
      await this.#query([
        ...upsert(
          'realm_versions',
          'realm_versions_pkey',
          nameExpressions,
          valueExpressions,
        ),
      ]);
      this.realmVersion = 1;
    } else {
      this.realmVersion = row.current_version + 1;
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
    // `has_error` and `error_doc` are listed (with explicit false / null
    // values per row) so the upsert's ON CONFLICT SET clause clears them.
    // The primary key is `(url, realm_url, type)` — no `realm_version` —
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
      'realm_version',
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
      return types.map((type) =>
        [
          id,
          trimExecutableExtension(rri(id)),
          type,
          this.realmVersion,
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
  }

  private async existingIndexTypes(
    invalidations: string[],
  ): Promise<Map<string, BoxelIndexTable['type'][]>> {
    if (invalidations.length === 0) {
      return new Map();
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    let rows = (await this.#query([
      'SELECT DISTINCT url, type FROM boxel_index WHERE',
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        [
          'url IN',
          ...addExplicitParens(
            separatedByCommas(uniqueInvalidations.map((id) => [param(id)])),
          ),
        ],
      ]),
    ] as Expression)) as Pick<BoxelIndexTable, 'url' | 'type'>[];
    let typesByUrl = new Map<string, BoxelIndexTable['type'][]>();
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

  private async urlsMatchingSeedFromCurrentBatch(
    seedURL: URL,
  ): Promise<string[]> {
    let rows = (await this.#query([
      `SELECT DISTINCT url FROM boxel_index_working WHERE`,
      ...every([
        ['realm_url =', param(this.realmURL.href)],
        ['realm_version =', param(this.realmVersion)],
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
    let results: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
      type: BoxelIndexTable['type'];
    })[] = [];
    let rows: (Pick<BoxelIndexTable, 'url' | 'file_alias'> & {
      type: BoxelIndexTable['type'];
    })[] = [];
    let pageNumber = 0;
    // Also search for the prefix form of the path (e.g. @cardstack/catalog/...)
    // since deps may be stored in prefix form for portability
    let unresolvedPath = this.unresolveURL(resolvedPath);
    let searchBothForms =
      unresolvedPath !== resolvedPath &&
      this.isRegisteredPrefix(unresolvedPath);
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
        'FROM boxel_index_working as i',
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
    this.#perfLog.debug(
      `${jobIdentity(this.jobInfo)} time to determine items that reference ${resolvedPath} ${
        Date.now() - start
      } ms (page count=${pageNumber})`,
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

function baseTypeFromError(
  entry: SearchIndexErrorEntry,
): Extract<BoxelIndexTable['type'], 'instance' | 'file'> {
  switch (entry.type) {
    case 'instance-error':
      return 'instance';
    case 'file-error':
      return 'file';
  }
}
