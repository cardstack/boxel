// Reading index rows that are not a search: one card or file by URL, link
// targets in bulk, live-row checks and generations, a card's source,
// captures, and which types the realm holds.
// Owns: those reads and turning a row into an `IndexedInstance`,
// `IndexedFile` or an instance error.
// Must not: compile a query filter (it reads by URL and type only).
// Guarantees: a render error leaves the data intact (the instance comes back
// with `renderError`); see `.claude/skills/index-query-engine/SKILL.md`.

import type { CaptureManifest } from '../capture-spec.ts';
import {
  type CardResource,
  type CodeRef,
  type Diagnostics,
  type ResolvedCodeRef,
  isResolvedCodeRef,
} from '../index.ts';
import {
  EFFECTIVE_ERROR_SELECTS,
  INDEX_HAS_ERROR,
  PRERENDERED_HTML_SELECTS,
  RENDER_ERROR_SELECT,
  assertIndexEntry,
  effectiveHasError,
  prerenderedJoin,
  tableFromOpts,
} from './index-sql.ts';
import { EngineCore } from './engine-core.ts';
import {
  type Expression,
  addExplicitParens,
  any,
  dbExpression,
  every,
  param,
  separatedByCommas,
  typesContains,
} from '../expression.ts';
import type { FileMetaResource } from '../resource-types.ts';
import type {
  GetEntryOptions,
  IndexRowWithHtml,
  IndexedFile,
  IndexedInstanceSource,
  InstanceOrError,
  LinkTargetFile,
  LinkTargetInstance,
} from './types.ts';
import {
  type RealmMetaValue,
  normalizeRealmMetaValue,
} from '../index-structure.ts';
import { type SerializedError, renderErrorSummary } from '../error.ts';
import { restoreSpilledSearchDocs } from '../search-doc-spill.ts';
import stringify from 'safe-stable-stringify';
import { verdictCoversRow } from '../index-writer.ts';

export abstract class IndexRows extends EngineCore {
  async getInstance(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<InstanceOrError | undefined> {
    let result = (await this.query([
      `SELECT i.*, ${PRERENDERED_HTML_SELECTS}, ${RENDER_ERROR_SELECT}`,
      `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
    ] as Expression)) as unknown as IndexRowWithHtml[];
    return this.#rowToInstanceOrError(result[0], url, opts);
  }

  // Batch read of the link targets `loadLinks` side-loads, selecting what link
  // expansion actually consumes and nothing else.
  //
  // The wide `getInstance` shape is the wrong one here, and not merely
  // wasteful. Whichever entry point reaches link expansion — a search's
  // projected roots or a single card+json document's own — expansion puts
  // only the resource into `included[]`. Rendered output for any of these
  // URLs is served by the render-set projection, which joins
  // `prerendered_html` itself and never reaches this code. So no caller of
  // this read can have asked for prerendered HTML.
  //
  // A `SELECT i.*` costs more than those formats, though: it also drags
  // `deps` and `last_known_good_deps`, each holding a few hundred dependency
  // URLs, which together dwarf everything else on the row. Both stay far
  // larger than the document even if a scoped-CSS dep stops carrying its
  // stylesheet inline, since the row's cost there is the number of deps
  // rather than the width of any one.
  //
  // So the select names its columns rather than starring: what a star
  // quietly includes is the whole of the expense, and two of the columns it
  // includes are ones nothing on this path reads.
  //
  // Returns a map keyed by the LOOKUP URL (matching either `i.url` or
  // `i.file_alias`), matching rows on the same type/tombstone predicate
  // `getInstance` uses. A row that is absent, deleted, or whose index visit
  // failed is simply not in the map — which is what link expansion does with
  // one anyway: it leaves the relationship naming a target the document does
  // not carry. A target whose render failed is included: side-loading puts
  // only its data into `included[]`, and that data is intact.
  async getLinkTargetInstances(
    urls: URL[],
    opts?: GetEntryOptions,
  ): Promise<Map<string, LinkTargetInstance>> {
    let resultMap = new Map<string, LinkTargetInstance>();
    if (urls.length === 0) {
      return resultMap;
    }
    let lookupHrefs = [...new Set(urls.map((u) => u.href))];
    // Each chunk emits 2*N + 1 placeholders (url IN list + file_alias IN list
    // + i.type param). Cap at half the existing url-batch sizes used in
    // index-writer.ts (sqlite=900, pg=5000) so we stay well under both
    // adapter parameter limits.
    let chunkSize = this.dialect.linkLookupChunkSize;
    for (let start = 0; start < lookupHrefs.length; start += chunkSize) {
      let chunk = lookupHrefs.slice(start, start + chunkSize);
      let chunkSet = new Set(chunk);
      let chunkParams = chunk.map((href) => [param(href)]);
      let rows = (await this.query([
        // `ph.captures` is the join's only consumer: it is joined into the
        // side-loaded resource's `meta`.
        `SELECT i.url, i.file_alias, i.pristine_doc,
                ph.captures AS captures`,
        `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
         WHERE`,
        ...every([
          any([
            ['i.url IN', ...addExplicitParens(separatedByCommas(chunkParams))],
            [
              'i.file_alias IN',
              ...addExplicitParens(separatedByCommas(chunkParams)),
            ],
          ]),
          ['i.type =', param('instance')],
          any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
          // An index error is excluded here rather than after the fact, as
          // the file leg of this same batch does: it keeps an errored
          // target's document off the wire too, which is this read's own
          // argument.
          [`NOT ${INDEX_HAS_ERROR}`],
        ]),
      ] as Expression)) as unknown as {
        url: string | null;
        file_alias: string | null;
        pristine_doc: CardResource | null;
        captures: CaptureManifest | null;
      }[];
      for (let row of rows) {
        if (!row.url) {
          continue;
        }
        // Every row here is live and unerrored, and such a row is required to
        // carry a document. One that does not is unrepresentable rather than
        // merely unavailable, so it is reported instead of dropped — a
        // dropped one is indistinguishable from a link whose target is
        // legitimately gone, and would silently cost the document a
        // relationship. This rejects the whole read, as the singular one does.
        if (!row.pristine_doc) {
          throw new Error(
            `bug: live index entry for ${row.url} with opts: ${stringify(
              opts,
            )} has no pristine_doc`,
          );
        }
        let target: LinkTargetInstance = {
          canonicalURL: row.url,
          resource: row.pristine_doc,
          captures: row.captures ?? null,
        };
        // A row may be addressable by its url or its file_alias.
        // Index the result under whichever lookup keys the caller asked about.
        if (chunkSet.has(row.url)) {
          resultMap.set(row.url, target);
        }
        if (row.file_alias && chunkSet.has(row.file_alias)) {
          resultMap.set(row.file_alias, target);
        }
      }
    }
    return resultMap;
  }

  // The live-instance row predicate, defined once: `getInstance`'s
  // url/file_alias match, instance type, and tombstone exclusion, plus the
  // effective error across both channels. The gates below serve prerendered
  // output, so a card whose render failed is not live to them even though
  // `getInstance` reads its data as an instance. Every liveness gate —
  // `hasLiveInstance`, `liveInstanceGeneration`, `liveInstanceCaptures` —
  // spreads this one fragment, so the DSL and `?name=` capture routes'
  // liveness semantics cannot silently split. (`findLiveInstanceGeneration` in media-cache.ts
  // is the realm-scoped raw-SQL twin, built from the same exported join
  // fragments.)
  #liveInstanceConditions(url: URL): Expression {
    return this.#liveRowConditions(url, 'instance');
  }

  // The same predicate over the URL's 'file' row — the file-flavored liveness
  // gate the `?name=` capture route falls back to when no instance
  // matches (a FileDef family's declared captures live on the file row).
  #liveRowConditions(url: URL, type: 'instance' | 'file'): Expression {
    return every([
      any([
        [`i.url =`, param(url.href)],
        [`i.file_alias =`, param(url.href)],
      ]),
      ['i.type =', param(type)],
      any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      [`NOT ${effectiveHasError()}`],
    ]) as Expression;
  }

  // Existence probe with the live-instance predicate, without hydrating the
  // row. `getInstance` selects every wide column in the index (prerendered
  // HTML, pristine/search docs), so callers that gate on liveness alone —
  // the capture route runs this on every request, 304 revalidations
  // included — must not pay for a hydration they discard.
  async hasLiveInstance(url: URL, opts?: GetEntryOptions): Promise<boolean> {
    let rows = (await this.query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      'WHERE',
      ...this.#liveInstanceConditions(url),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  // The index generation of a live instance, or undefined when none matches —
  // the generation companion to `hasLiveInstance`, selecting the one column
  // the capture cache key needs, still without hydrating the row. Used
  // where the caller needs both the liveness gate and the generation, so the
  // two collapse into a single narrow read.
  async liveInstanceGeneration(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<number | undefined> {
    let rows = (await this.query([
      'SELECT i.generation',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      'WHERE',
      ...this.#liveInstanceConditions(url),
      'LIMIT 1',
    ] as Expression)) as unknown as { generation: number }[];
    return rows.length > 0 ? Number(rows[0].generation) : undefined;
  }

  // An instance's row from `boxel_index` alone, with no `prerendered_html`
  // join: what its index visit read and recorded, and whether that visit
  // failed. A render error is not reflected, so a card whose rendering failed
  // still reads as the instance its source says it is. For a reader that
  // needs the card's data and adoption chain, and none of its rendering.
  async getInstanceSource(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedInstanceSource | undefined> {
    let rows = (await this.query([
      'SELECT i.url, i.realm_url, i.generation, i.source_content_hash, i.types, i.pristine_doc, i.has_error, i.error_doc, i.diagnostics',
      `FROM ${tableFromOpts(opts)} AS i`,
      'WHERE',
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as {
      url: string;
      realm_url: string;
      generation: number;
      source_content_hash: string | null;
      types: string[] | null;
      pristine_doc: CardResource | null;
      has_error: boolean | null;
      error_doc: SerializedError | null;
      diagnostics: Diagnostics | null;
    }[];
    let row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      url: row.url,
      realmURL: row.realm_url,
      generation: Number(row.generation),
      sourceContentHash: row.source_content_hash ?? null,
      types: row.types,
      instance: row.has_error ? null : row.pristine_doc,
      error: row.has_error ? row.error_doc : null,
      failureWithheld:
        !row.has_error &&
        verdictCoversRow(row.diagnostics ?? undefined, 'instance'),
    };
  }

  // The declared-capture manifest of a live instance — the `?name=`
  // serving route's addressing read: the shared live-instance predicate (so
  // a name resolves exactly when a DSL capture of the same instance would).
  // `undefined` means no live instance matches; a live row comes back with
  // its canonical `url` (the lookup also matches `file_alias`, and the
  // MediaCache ledger is keyed off the row's own spelling, never the
  // request's) and a `manifest` that is null when nothing has been captured.
  async liveInstanceCaptures(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<{ url: string; manifest: CaptureManifest | null } | undefined> {
    return await this.#liveRowCaptures(url, 'instance', opts);
  }

  // The file-row twin of `liveInstanceCaptures`: the declared-capture
  // manifest of a live 'file' row. The `?name=` serving route falls back to
  // this when the addressed path resolves to no live instance — a FileDef
  // family's declared captures are persisted on the file rendering's row.
  async liveFileCaptures(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<{ url: string; manifest: CaptureManifest | null } | undefined> {
    return await this.#liveRowCaptures(url, 'file', opts);
  }

  async #liveRowCaptures(
    url: URL,
    type: 'instance' | 'file',
    opts?: GetEntryOptions,
  ): Promise<{ url: string; manifest: CaptureManifest | null } | undefined> {
    let rows = (await this.query([
      'SELECT i.url AS url, ph.captures AS captures',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      'WHERE',
      ...this.#liveRowConditions(url, type),
      'LIMIT 1',
    ] as Expression)) as unknown as {
      url: string;
      captures: CaptureManifest | null;
    }[];
    if (rows.length === 0) {
      return undefined;
    }
    return { url: rows[0].url, manifest: rows[0].captures ?? null };
  }

  // Shared row → InstanceOrError mapping for getInstance.
  // `lookupURL` is used only for error context and is optional in the batch path.
  // A card's row, read as its data: the instance its index visit read, or the
  // error that visit recorded. Only the index channel decides between the two.
  // A render failure leaves the data intact, so it comes back as the instance
  // with `renderError` set rather than as an `instance-error`.
  #rowToInstanceOrError(
    maybeResult: IndexRowWithHtml | undefined,
    lookupURL: URL | undefined,
    opts?: GetEntryOptions,
  ): InstanceOrError | undefined {
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let {
      url: canonicalURL,
      pristine_doc: instance,
      isolated_html: isolatedHtml,
      head_html: headHtml,
      atom_html: atomHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      markdown,
      search_doc: searchDoc,
      captures,
      generation,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      resource_created_at: resourceCreatedAt,
      types,
      deps,
      source_content_hash: sourceContentHash,
    } = maybeResult;
    let baseResult = {
      canonicalURL,
      realmURL,
      instance,
      sourceContentHash: sourceContentHash ?? null,
      isolatedHtml,
      headHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      markdown,
      searchDoc,
      captures: (captures as CaptureManifest | null) ?? null,
      types,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
      deps,
      lastModified: lastModified != null ? parseInt(lastModified) : null,
      resourceCreatedAt:
        resourceCreatedAt != null ? parseInt(resourceCreatedAt) : null,
      generation,
    };

    if (maybeResult.has_error) {
      return {
        ...baseResult,
        type: 'instance-error',
        error: maybeResult.error_doc!,
      };
    }
    let instanceEntry = assertIndexEntry(maybeResult);
    if (!instance) {
      throw new Error(
        `bug: index entry for ${
          lookupURL?.href ?? canonicalURL
        } with opts: ${stringify(
          opts,
        )} has neither an error_doc nor a pristine_doc`,
      );
    }
    return {
      ...baseResult,
      type: 'instance',
      instance,
      renderError: maybeResult.render_error_doc
        ? renderErrorSummary(maybeResult.render_error_doc)
        : null,
      lastModified:
        instanceEntry.last_modified != null
          ? parseInt(instanceEntry.last_modified)
          : null,
      resourceCreatedAt: parseInt(instanceEntry.resource_created_at),
    };
  }

  async getFile(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedFile | undefined> {
    let result = (await this.query([
      `SELECT i.*, ${PRERENDERED_HTML_SELECTS}, ${EFFECTIVE_ERROR_SELECTS}`,
      `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('file')],
        [`NOT ${effectiveHasError()}`],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
    ] as Expression)) as unknown as IndexRowWithHtml[];
    return this.#rowToIndexedFile(result[0]);
  }

  // Batch read of the file-meta link targets `loadLinks` side-loads — the
  // file leg of the same batch `getLinkTargetInstances` serves, narrow for the
  // same reason. A side-loaded file's resource is assembled from its stored
  // document, its search doc and its timestamps; the formats, the icon, the
  // display names and the dependency graph are all fetched and discarded by a
  // star select, and `deps` is the widest column on the row.
  //
  // Keys are the LOOKUP URLs the caller passed in (matching either `i.url` or
  // `i.file_alias`). As on the instance leg, only an index error keeps a file
  // out: a file whose render failed still has the data side-loading reads.
  async getLinkTargetFiles(
    urls: URL[],
    opts?: GetEntryOptions,
  ): Promise<Map<string, LinkTargetFile>> {
    let resultMap = new Map<string, LinkTargetFile>();
    if (urls.length === 0) {
      return resultMap;
    }
    let lookupHrefs = [...new Set(urls.map((u) => u.href))];
    // Same chunking discipline as getLinkTargetInstances — keeps placeholder count
    // safely below the sqlite/pg parameter limits.
    let chunkSize = this.dialect.linkLookupChunkSize;
    for (let start = 0; start < lookupHrefs.length; start += chunkSize) {
      let chunk = lookupHrefs.slice(start, start + chunkSize);
      let chunkSet = new Set(chunk);
      let chunkParams = chunk.map((href) => [param(href)]);
      let rows = (await this.query([
        // `ph.captures` is the join's only consumer: it is joined into the
        // side-loaded resource's `meta`.
        `SELECT i.url, i.file_alias, i.pristine_doc, i.search_doc, i.types,
                i.last_modified, i.resource_created_at, i.realm_url,
                ph.captures AS captures`,
        `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
         WHERE`,
        ...every([
          any([
            ['i.url IN', ...addExplicitParens(separatedByCommas(chunkParams))],
            [
              'i.file_alias IN',
              ...addExplicitParens(separatedByCommas(chunkParams)),
            ],
          ]),
          ['i.type =', param('file')],
          [`NOT ${INDEX_HAS_ERROR}`],
          any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
        ]),
      ] as Expression)) as unknown as {
        url: string | null;
        file_alias: string | null;
        pristine_doc: FileMetaResource | null;
        search_doc: Record<string, any> | null;
        types: string[] | null;
        last_modified: string | number | null;
        resource_created_at: string | number | null;
        realm_url: string | null;
        captures: CaptureManifest | null;
      }[];
      await restoreSpilledSearchDocs(this.dbAdapter, rows);
      for (let row of rows) {
        if (!row.url) {
          continue;
        }
        // Postgres hands back a bigint column as a string; SQLite as a number.
        let toEpoch = (v: string | number | null) =>
          typeof v === 'string' ? parseInt(v) : (v ?? null);
        let mapped: LinkTargetFile = {
          canonicalURL: row.url,
          resource: row.pristine_doc ?? null,
          searchDoc: row.search_doc ?? null,
          types: row.types ?? null,
          lastModified: toEpoch(row.last_modified),
          resourceCreatedAt: toEpoch(row.resource_created_at),
          realmURL: row.realm_url ?? '',
          captures: row.captures ?? null,
        };
        if (chunkSet.has(row.url)) {
          resultMap.set(row.url, mapped);
        }
        if (row.file_alias && chunkSet.has(row.file_alias)) {
          resultMap.set(row.file_alias, mapped);
        }
      }
    }
    return resultMap;
  }

  #rowToIndexedFile(
    maybeResult: IndexRowWithHtml | undefined,
  ): IndexedFile | undefined {
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let {
      url: canonicalURL,
      pristine_doc: resource,
      search_doc: searchDoc,
      isolated_html: isolatedHtml,
      head_html: headHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      atom_html: atomHtml,
      icon_html: iconHtml,
      markdown,
      captures,
      generation,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      resource_created_at: resourceCreatedAt,
      deps,
      types,
      display_names: displayNames,
    } = maybeResult;
    generation =
      typeof generation === 'string' ? parseInt(generation) : (generation ?? 0);
    return {
      type: 'file',
      canonicalURL,
      searchDoc,
      resource: (resource as FileMetaResource | null) ?? null,
      types,
      displayNames,
      deps,
      isolatedHtml,
      headHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      iconHtml: iconHtml ?? null,
      markdown,
      captures: (captures as CaptureManifest | null) ?? null,
      lastModified: lastModified != null ? parseInt(lastModified) : null,
      resourceCreatedAt:
        resourceCreatedAt != null ? parseInt(resourceCreatedAt) : null,
      generation,
      realmURL,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
    };
  }

  async hasFileType(
    realmURL: URL,
    ref: CodeRef,
    opts?: GetEntryOptions,
  ): Promise<boolean> {
    if (!isResolvedCodeRef(ref)) {
      return false;
    }
    let typeKeys = await this.typeKeysFor(ref);
    let rows = (await this.query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i`,
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('file')],
        any(typeKeys.map((typeKey) => [typesContains(typeKey)])),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  async hasInstanceType(
    realmURL: URL,
    ref: CodeRef,
    opts?: GetEntryOptions,
  ): Promise<boolean> {
    if (!isResolvedCodeRef(ref)) {
      return false;
    }
    let typeKeys = await this.typeKeysFor(ref);
    let rows = (await this.query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i`,
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('instance')],
        any(typeKeys.map((typeKey) => [typesContains(typeKey)])),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  // The types a realm holds cards of that descend from `ref`: the first entry
  // of the adoption chain of every live instance row whose chain carries one
  // of the ref's keys, once each. A row of the ref's own type contributes its
  // own key. Rows whose visit failed count too, since a search that includes
  // errors can return them.
  async instanceTypesUnder(
    realmURL: URL,
    ref: ResolvedCodeRef,
  ): Promise<string[]> {
    let typeKeys = await this.typeKeysFor(ref);
    let rows = (await this.query([
      'SELECT DISTINCT',
      dbExpression({
        pg: `i.types->>0`,
        sqlite: `json_extract(i.types, '$[0]')`,
      }),
      'AS type_key',
      'FROM boxel_index AS i',
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
        any(typeKeys.map((typeKey) => [typesContains(typeKey)])),
      ]),
    ] as Expression)) as unknown as { type_key: string | null }[];
    return rows
      .map(({ type_key }) => type_key)
      .filter((key): key is string => typeof key === 'string')
      .sort();
  }

  async fetchCardTypeSummary(realmURL: URL): Promise<RealmMetaValue> {
    // JOIN against realm_generations.current_generation so we always pick the
    // realm_meta row that matches the realm's authoritative current
    // generation. Naive `SELECT … WHERE realm_url=…` returns an arbitrary
    // row when stale rows linger (e.g., a from-scratch reindex resets
    // the generation to a low number, leaving older high-generation rows that
    // the legacy prune predicate `generation < <new>` never reaches).
    // Ordering by `generation DESC` would actually pick the *wrong*
    // row after a from-scratch — the highest generation is the oldest.
    // realm_generations is the system source of truth for "which generation
    // is current," so anchoring the read there is the robust fix.
    let results = (await this.query([
      `SELECT rm.value
       FROM realm_meta rm
       JOIN realm_generations rg
         ON rg.realm_url = rm.realm_url
        AND rg.current_generation = rm.generation
       WHERE`,
      ...every([['rm.realm_url =', param(realmURL.href)]]),
      `LIMIT 1`,
    ] as Expression)) as { value: unknown }[];

    return normalizeRealmMetaValue(results[0]?.value);
  }
}
