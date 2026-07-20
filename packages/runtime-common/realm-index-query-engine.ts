import { isScopedCSSRequest } from './scoped-css.ts';
import { cloneDeep } from 'lodash-es';
import {
  SupportedMimeType,
  isJsonContentType,
  baseRealmRRI,
  inferContentType,
  unixTime,
  maxLinkDepth,
  maybeURL,
  IndexQueryEngine,
  fileEntryFromResult,
  codeRefWithAbsoluteIdentifier,
  logger,
  CardResourceType,
  FileMetaResourceType,
  type LooseCardResource,
  type DBAdapter,
  type QueryOptions,
  type InstanceOrError,
  type IndexedFile,
  type DefinitionLookup,
  type ResolvedCodeRef,
  type SearchProjection,
  internalKeyFor,
  visitInstanceURLs,
  maybeRelativeReference,
  codeRefFromInternalKey,
} from './index.ts';
import type { Realm } from './realm.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import { FILE_META_RESERVED_KEYS } from './realm.ts';
import { RealmPaths } from './paths.ts';
import type { RequestTimings } from './request-timings.ts';
import type {
  RealmResourceIdentifier,
  RealmIdentifier,
} from './realm-identifiers.ts';
import { rri } from './realm-identifiers.ts';
import type { Filter, Query } from './query.ts';
import { CardError, type SerializedError } from './error.ts';
import {
  isCodeRef,
  isResolvedCodeRef,
  visitModuleDeps,
  type CodeRef,
} from './code-ref.ts';
import {
  isSingleCardDocument,
  isSingleFileMetaDocument,
  type SingleCardDocument,
  type EntryCollectionDocument,
  type EntrySingleDocument,
  type EntryIncludedResource,
  isEntryCollectionDocument,
} from './document-types.ts';
import { resourceIdentity } from './resource-identity.ts';
import { relationshipEntries } from './relationship-utils.ts';
import type {
  CardResource,
  CssResource,
  FileMetaResource,
  HtmlQuery,
  IconResource,
  QueryFieldMeta,
  Saved,
  EntryResource,
} from './resource-types.ts';
import {
  buildCssResource,
  parseUsedRenderType,
  scopedCssHrefsFromDeps,
} from './search-resource-helpers.ts';
import {
  buildHtmlResource,
  buildIconResource,
  buildEntryResource,
  buildSparseItemResource,
  htmlQueryFormats,
  htmlQueryHasRenderTypePredicate,
  htmlQueryMatches,
  resolveHtmlQuery,
  searchEntryWireQueryFromQuery,
  type RenderingCandidate,
  type SearchEntryFieldset,
  type SearchEntryQuery,
} from './search-entry.ts';
import type { FieldDefinition } from './definitions.ts';
import { urlNamesFile } from './file-def-code-ref.ts';
import {
  normalizeQueryDefinition,
  buildQuerySearchURL,
  getValueForResourcePath,
} from './query-field-utils.ts';

// We allow up to this many traversals into the same card type per
// `populateQueryFields` walk, matching the field-set the host emits at
// indexing time (`getFieldDefinitions` in `runtime-common/definitions.ts`
// uses the same depth for repeated card types).
const RECURSING_DEPTH = 3;

type Options = {
  loadLinks?: true;
  linkFields?: string[];
  // When true, populateQueryFields will only use cached definitions from the
  // database and will never trigger a prerenderer call.  This prevents deadlocks
  // when file-meta responses are served during card prerendering (the single
  // prerender semaphore permit is already held).
  cacheOnlyDefinitions?: boolean;
  // Worker-job priority threaded from the caller (typically
  // `_federated-search`'s `x-boxel-job-priority` header, set by the
  // host's fetch wrapper during a prerendered card render). Forwarded
  // to `lookupDefinition` so any sub-`prerenderModule` fired for a
  // missed `type:` filter resolution inherits the originating
  // priority. Defaults to 0 when absent.
  priority?: number;
  // When true, `loadLinks` populates `relationships.{field}.data` for
  // query-backed `linksTo` / `linksToMany` fields but does NOT push
  // the linked resources into `included[]`. Static linksTo / linksToMany
  // still expand transitively. Set by the realm-server card-document
  // handlers (GET / POST / PATCH) when the request originates inside a
  // prerender — the caller can resolve the listed IDs via per-URL fetches,
  // and the eager closure is a wasted round-trip in that context. The
  // umbrella relationship carries `links.search` only when written by
  // `applyQueryResults`, so that key is the per-field "is this
  // query-backed?" signal at follow time. (The search path does not use
  // this flag — see `omitIncluded`.)
  skipQueryBackedExpansion?: boolean;
  // When true, `searchCardsUncoalesced` skips the `loadLinks` /
  // `populateQueryFields` pass entirely. Each result still carries its
  // pristine index row (id + attributes + any static-link relationships)
  // plus page meta, but the pass that would add query-field
  // `relationships.{field}.data` umbrellas and expand linked resources into
  // `included[]` does not run — so neither is present. Set by the
  // realm-server search handlers when the request originates inside a
  // prerender: the host re-resolves every result card from its raw
  // card+source file and reads only `data[].id`, so that assembly is
  // throwaway work in that context. Strictly prerender-scoped — live /
  // external `_federated-search` callers still receive fully-assembled
  // compound documents.
  omitIncluded?: boolean;
  // Per-request wall-clock collector, threaded from `searchRealms` when a
  // request carries a correlation id. The post-SQL stages here — the SQL
  // query and the `loadLinks` relationship assembly — stamp their elapsed
  // time on it so the handler can attribute the request's server-side time
  // across stages. Absent (and so a no-op) for everything except
  // instrumented `_federated-search` calls.
  timings?: RequestTimings;
  // Cooperative-cancellation signal for the search handler's per-request time
  // budget. When present, `loadLinks` checks it between BFS layers so an
  // over-budget item-leg search stops its relationship-assembly fan-out
  // promptly instead of running every layer to completion. Threaded like
  // `timings`; absent for everything except a bounded live search.
  signal?: AbortSignal;
} & QueryOptions;

type SearchResult = SearchResultDoc | SearchResultError;

interface SearchResultDoc {
  type: 'doc';
  doc: SingleCardDocument;
  // The primary card's index-data generation (`boxel_index.generation`). The
  // realm's card+json GET handler stamps it onto the response's per-instance
  // `meta` so a consumer can tell fresh index data from stale. Kept off the
  // assembled `doc` here — direct `cardDocument()` callers (indexing, POST /
  // PATCH echoes) don't surface it — and applied only on the GET response.
  generation: number;
  // indexed_at on the primary card's index row. Bumps on every reindex
  // (direct file write OR dependency-triggered re-write), so it's a
  // complete fingerprint for the assembled card+json document and is
  // used as the ETag base by the realm's GET/PATCH handlers.
  indexedAt: number | null;
  // deps array on the primary card's index row. Used by the realm's
  // GET/PATCH handlers to detect foreign-realm dependencies — when
  // present, ETag emission is suppressed because cross-realm
  // invalidation does not cascade indexed_at (see
  // `index-writer.ts.calculateInvalidations` realm_url filter).
  deps: string[] | null;
}

export interface SearchResultError {
  type: 'error';
  error: {
    lastKnownGoodHtml: string | null;
    scopedCssUrls: string[];
    errorDetail: SerializedError;
    cardTitle: string | null;
  };
}

type QueryFieldErrorType = 'authorization' | 'network' | 'unknown';

type QueryFieldErrorDetail = {
  realm: string;
  type: QueryFieldErrorType;
  message: string;
  status?: number;
};

function absolutizeInstanceURL(
  url: string,
  resourceId: string | undefined,
  setURL: (newURL: string) => void,
  virtualNetwork: VirtualNetwork,
) {
  // Registered prefix references (e.g. @cardstack/catalog/foo) are already
  // in their canonical portable form — don't resolve them.
  if (virtualNetwork.isRegisteredPrefix(url)) {
    return;
  }
  if (!resourceId) {
    setURL(url);
    return;
  }
  setURL(virtualNetwork.resolveURL(url, resourceId).href);
}

export class RealmIndexQueryEngine {
  #realm: Realm;
  #realmURL: URL | undefined;
  #fetch: typeof globalThis.fetch;
  #indexQueryEngine: IndexQueryEngine;
  #definitionLookup: DefinitionLookup;
  #log = logger('realm:index-query-engine');

  constructor({
    realm,
    dbAdapter,
    fetch,
    definitionLookup,
  }: {
    realm: Realm;
    dbAdapter: DBAdapter;
    fetch: typeof globalThis.fetch;
    definitionLookup: DefinitionLookup;
  }) {
    if (!dbAdapter) {
      throw new Error(
        `DB Adapter was not provided to SearchIndex constructor--this is required when using a db based index`,
      );
    }
    this.#indexQueryEngine = new IndexQueryEngine(
      dbAdapter,
      definitionLookup,
      realm.virtualNetwork,
    );
    this.#definitionLookup = definitionLookup;
    this.#realm = realm;
    this.#fetch = fetch;
  }

  private get realmURL() {
    return (this.#realmURL ??= new URL(this.#realm.url));
  }

  // The entry engine. Runs the parsed entry query — the
  // `item.` membership query against the SQL core, then the htmlQuery
  // evaluated per candidate rendering in this mapper — and assembles a
  // heterogeneous `entry` document: one entry per result, with the
  // selected `html` renderings (+ deduped `css`) and/or `item` resources in
  // `included` per the sparse fieldset.
  //
  // Branch emission per entry:
  //   - `fieldset.html` → one `html` resource per rendering the htmlQuery
  //     selects from the row's rendering set (formats × ancestor render
  //     types; error rows flag their renderings `isError`). A pinned html
  //     branch emits an empty `data: []` when nothing matches; the default
  //     mode omits the relationship on fallback rows instead.
  //   - a pinned `item` (`fieldset.item` full/sparse) rides on every row; the
  //     default mode (`itemAsFallback`) emits it only where no rendering
  //     matched. Sparse items carry `meta.sparseFields` and skip the link
  //     expansion; full items go through `loadLinks` (same gating as the live
  //     search path).
  //
  // When no renderType predicate appears anywhere in the htmlQuery, only each
  // result's own native type (`types[0]`) is in play; an explicit predicate
  // opens the full adoption-chain universe. The applied htmlQuery is echoed
  // once as `meta.htmlQuery` whenever the html branch is in play.
  async searchEntries(
    searchEntryQuery: SearchEntryQuery,
    opts?: Options,
    // Internal override for the single-URL GET path, which pins 'instance' so a
    // bare file URL never resolves as a card entry. When omitted, the scope
    // comes from the wire `searchEntryQuery.scope` (mapped below): 'cards' ->
    // 'instance', 'files' -> 'file', 'all'/absent -> 'all'.
    entryTypeScopeOverride?: 'instance' | 'file' | 'all',
  ): Promise<EntryCollectionDocument> {
    let {
      itemQuery: query,
      htmlQuery,
      fieldset,
      cardUrls,
      scope,
    } = searchEntryQuery;
    let engineOpts: Options = {
      ...opts,
      ...(cardUrls && cardUrls.length > 0 ? { cardUrls } : {}),
    };

    // `scope` pins `boxel_index.type` directly. 'all' searches both kinds in one
    // query — a card row and a file row carry non-overlapping `types`, so the
    // caller's filter also discriminates by kind. A mixed 'all' query returns
    // both a card's `instance` row and its dual-indexed `.json` `file` row; a
    // consumer that wants the file row dropped does so through its own filter
    // (`eq: { item._isCardInstanceFile: false }`).
    let entryTypeScope: 'instance' | 'file' | 'all' =
      entryTypeScopeOverride ??
      (scope === 'cards' ? 'instance' : scope === 'files' ? 'file' : 'all');

    let itemOnEveryRow = fieldset.item.kind !== 'none';
    let projection: SearchProjection = fieldset.html
      ? { kind: 'renderSet' }
      : { kind: 'dataOnly' };
    // Error rows surface only through the `html` branch (their renderings
    // carry `isError`); the item-only projection matches the live search
    // path, which excludes them. The 'files' scope never includes errors —
    // files are only ever surfaced healthy (the mixed 'all' scope forces the
    // same for its file branch in `_search`) — so it strips includeErrors even
    // when an html fieldset would otherwise set it.
    let sqlOpts: QueryOptions;
    if (entryTypeScope === 'file') {
      let { includeErrors: _drop, ...rest } = engineOpts;
      sqlOpts = rest;
    } else if (fieldset.html) {
      sqlOpts = { ...engineOpts, includeErrors: true };
    } else {
      sqlOpts = engineOpts;
    }
    let runSql = () =>
      this.#indexQueryEngine.search(
        new URL(this.#realm.url),
        query,
        sqlOpts,
        projection,
        entryTypeScope,
      );
    let { results, meta } = opts?.timings
      ? await opts.timings.time('sql', runSql)
      : await runSql();

    // Resolve the htmlQuery's renderType CodeRefs to their `<module>/<name>`
    // keys once; the pure evaluator then runs per candidate rendering.
    let resolvedHtmlQuery = resolveHtmlQuery(htmlQuery, (ref) =>
      internalKeyFor(ref, undefined, this.#realm.virtualNetwork),
    );
    let nativeOnly = !htmlQueryHasRenderTypePredicate(htmlQuery);

    let data: EntryResource[] = [];
    let htmlResources: EntryIncludedResource[] = [];
    let itemResources: (CardResource<Saved> | FileMetaResource)[] = [];
    let cssById = new Map<string, CssResource>();
    let iconById = new Map<string, IconResource>();
    let fullItemRoots: (CardResource<Saved> | FileMetaResource)[] = [];

    for (let row of results) {
      // A `file` row (mixed 'all' scope) renders natively and carries no
      // ancestor coercion — its renderings hang off its own type's entry with
      // no renderTypeKey, and its resource is the synthesized `file-meta`. This
      // is the file counterpart of the instance branch below; kind is decided
      // per row on `row.type`.
      if (row.type === 'file') {
        let file = fileEntryFromResult(row);
        let url = file.canonicalURL;
        if (!url) {
          continue;
        }
        let fileHtmlIds: string[] | undefined;
        let fileIconId = collectIconId(
          fieldset.html ? file.types?.[0] : undefined,
          fieldset.html ? (file.iconHtml ?? undefined) : undefined,
          file.displayNames?.[0] ?? '',
          iconById,
        );
        if (fieldset.html) {
          let matched = enumerateFileRenderings(file).filter((candidate) =>
            htmlQueryMatches(resolvedHtmlQuery, candidate),
          );
          let cssIds: string[] = [];
          if (matched.length > 0) {
            for (let href of scopedCssHrefsFromDeps(file.deps)) {
              let css = buildCssResource(href);
              if (!cssById.has(css.id)) {
                cssById.set(css.id, css);
              }
              cssIds.push(css.id);
            }
          }
          let ids: string[] = [];
          for (let candidate of matched) {
            let htmlResource = buildHtmlResource({
              url,
              format: candidate.format,
              html: candidate.html,
              cardType: file.displayNames?.[0] ?? '',
              cssIds,
              generation: file.htmlGeneration ?? file.generation,
            });
            htmlResources.push(htmlResource);
            ids.push(htmlResource.id);
          }
          fileHtmlIds =
            fieldset.itemAsFallback && ids.length === 0 ? undefined : ids;
        }
        let emitFileItem =
          itemOnEveryRow ||
          (fieldset.itemAsFallback && fileHtmlIds === undefined);
        let fileItemEmitted = false;
        if (emitFileItem) {
          let item: FileMetaResource = fileResourceFromIndex(
            new URL(url),
            file,
          );
          if (fieldset.item.kind === 'sparse') {
            item = buildSparseItemResource(item, fieldset.item.fields);
          } else {
            fullItemRoots.push(item);
          }
          itemResources.push(item);
          fileItemEmitted = true;
        }
        data.push(
          buildEntryResource({
            url,
            htmlIds: fileHtmlIds,
            itemType: fileItemEmitted ? FileMetaResourceType : undefined,
            iconId: fileIconId,
            generation: file.generation,
          }),
        );
        continue;
      }
      let fileUrl = row.url;
      if (!fileUrl) {
        continue;
      }
      // The index `url` column is the instance's file URL; a result's identity
      // (shared by the `entry` and its `item`) drops the `.json`
      // extension.
      let cardUrl = fileUrl.endsWith('.json') ? fileUrl.slice(0, -5) : fileUrl;
      let hasError = Boolean(row.has_error);
      // The entry carries its index-data generation (`boxel_index.generation`);
      // each `html` rendering carries the generation it was produced at
      // (`prerendered_html.generation`). The two channels advance
      // independently, so they can differ per row.
      let generation = (row.generation as number | null | undefined) ?? 0;
      let htmlGeneration =
        (row.html_generation as number | null | undefined) ?? generation;

      let htmlIds: string[] | undefined;
      // The result's type icon, deduped by native-type internal key. Resolved
      // alongside the html branch (a consumer that asks for renderings is the
      // one that paints icons), but emitted on the `entry` itself so a
      // fallback row with no matching rendering still carries it.
      let iconId = collectIconId(
        fieldset.html ? (row.types as string[] | null)?.[0] : undefined,
        fieldset.html
          ? ((row.icon_html as string | null) ?? undefined)
          : undefined,
        (row.display_names as string[] | null)?.[0] ?? '',
        iconById,
      );
      if (fieldset.html) {
        let nativeKey = (row.types as string[] | null)?.[0];
        let candidates = enumerateRowRenderings(row);
        if (nativeOnly) {
          candidates = candidates.filter(
            (candidate) =>
              nativeKey != null && candidate.renderTypeKey === nativeKey,
          );
        }
        let matched = candidates.filter((candidate) =>
          htmlQueryMatches(resolvedHtmlQuery, candidate),
        );
        let cssIds: string[] = [];
        if (matched.length > 0) {
          for (let href of scopedCssHrefsFromDeps(
            row.deps as string[] | null,
          )) {
            let css = buildCssResource(href);
            if (!cssById.has(css.id)) {
              cssById.set(css.id, css);
            }
            cssIds.push(css.id);
          }
        }
        let ids: string[] = [];
        for (let candidate of matched) {
          let htmlResource = buildHtmlResource({
            url: cardUrl,
            format: candidate.format,
            renderType: parseUsedRenderType(candidate.renderTypeKey) as
              | ResolvedCodeRef
              | undefined,
            html: candidate.html,
            cardType: (row.display_names as string[] | null)?.[0] ?? '',
            isError: hasError || undefined,
            cssIds,
            generation: htmlGeneration,
          });
          htmlResources.push(htmlResource);
          ids.push(htmlResource.id);
        }
        if (matched.length === 0 && hasError) {
          // An error row's rendering set isn't empty-pending — the indexer
          // ran and failed. Surface one error rendering (no last-known-good
          // markup) per format the htmlQuery names, at the row's own type.
          for (let format of htmlQueryFormats(htmlQuery)) {
            let htmlResource = buildHtmlResource({
              url: cardUrl,
              format,
              renderType: parseUsedRenderType(nativeKey) as
                | ResolvedCodeRef
                | undefined,
              cardType: (row.display_names as string[] | null)?.[0] ?? '',
              isError: true,
              cssIds: [],
              generation: htmlGeneration,
            });
            htmlResources.push(htmlResource);
            ids.push(htmlResource.id);
          }
        }
        // A pinned html branch always carries the (possibly empty) array;
        // the default mode omits the relationship on fallback rows.
        htmlIds = fieldset.itemAsFallback && ids.length === 0 ? undefined : ids;
      }

      let itemType: typeof CardResourceType | undefined;
      let emitItem =
        itemOnEveryRow || (fieldset.itemAsFallback && htmlIds === undefined);
      let pristine = row.pristine_doc as CardResource<Saved> | null;
      // A row can have nothing renderable AND no serialization — an error row
      // whose first indexing attempt failed (no last-known-good renderings,
      // no pristine doc). Keep its membership visible through the empty html
      // array rather than emitting an entry with neither branch.
      if (fieldset.html && htmlIds === undefined && !pristine) {
        htmlIds = [];
        emitItem = false;
      }
      if (emitItem && pristine) {
        // `pristine_doc` is stored with its id unresolved to the realm's
        // registered alias prefix (e.g. `@cardstack/catalog/...`) for
        // storage portability. The search-entry's `item` relationship
        // always points at `cardUrl` (the row's resolved absolute URL,
        // shared with the entry's own id) — the included resource's id
        // must match that exactly or a JSON:API consumer's relationship
        // lookup silently finds nothing.
        let item: CardResource<Saved> = {
          ...pristine,
          id: cardUrl as RealmResourceIdentifier,
          links: { self: cardUrl },
        };
        if (fieldset.item.kind === 'sparse') {
          item = buildSparseItemResource(item, fieldset.item.fields);
        } else {
          fullItemRoots.push(item);
        }
        itemResources.push(item);
        itemType = CardResourceType;
      }

      data.push(
        buildEntryResource({
          url: cardUrl,
          htmlIds,
          itemType,
          iconId,
          generation,
        }),
      );
    }

    let metaWithEcho: EntryCollectionDocument['meta'] = fieldset.html
      ? { ...meta, htmlQuery }
      : meta;
    return await this.assembleSearchEntryDoc(
      { data, meta: metaWithEcho },
      { htmlResources, cssById, iconById, itemResources, fullItemRoots },
      opts,
    );
  }

  // The single-instance counterpart of `searchEntries`: one entry sourced by
  // URL rather than by a membership query. `kind` selects the instance vs file
  // projection — the caller's accept header is the discriminator (card+html →
  // instance, file-meta+html → file), mirroring the card+json vs
  // file-meta+json GET split. Reuses the collection path with a one-URL
  // `cardUrls` filter (so all the rendering enumeration / htmlQuery matching /
  // css + icon dedup / item serialization + loadLinks assembly is shared),
  // then unwraps to a single-resource document. Returns undefined when no row
  // matches the URL (the handler 404s).
  async searchEntry(
    url: URL,
    args: {
      htmlQuery: HtmlQuery;
      fieldset: SearchEntryFieldset;
      kind: 'instance' | 'file';
    },
    opts?: Options,
  ): Promise<EntrySingleDocument | undefined> {
    let { htmlQuery, fieldset, kind } = args;
    let searchEntryQuery: SearchEntryQuery = {
      itemQuery: {},
      htmlQuery,
      fieldset,
      cardUrls: [url.href],
    };
    // Pin the scope by kind: a membership query resolves a card `.json`'s URL
    // to its `instance` entry, so a file's entry must be requested explicitly by
    // accept header ('file'), and a by-URL card lookup pins 'instance' so a bare
    // file URL 404s rather than resolving as a file-meta entry. Both scopes run
    // through the one `searchEntries` assembly loop (the file rows via its
    // `row.type === 'file'` branch).
    let collection = await this.searchEntries(
      searchEntryQuery,
      opts,
      kind === 'file' ? 'file' : 'instance',
    );
    let [entry] = collection.data;
    if (!entry) {
      return undefined;
    }
    let doc: EntrySingleDocument = { data: entry };
    if (collection.included && collection.included.length > 0) {
      doc.included = collection.included;
    }
    return doc;
  }

  // Shared tail of the two searchEntries paths: stitch `included` together
  // (html renderings first, then the deduped css, then the items), expand
  // links for the full items only (sparse items are field-limited data reads
  // and identity-only entries have nothing to expand), same gating as the
  // live search path. Items carry `meta.realmInfo` exactly as the live
  // search path serializes them.
  private async assembleSearchEntryDoc(
    doc: EntryCollectionDocument,
    resources: {
      htmlResources: EntryIncludedResource[];
      cssById: Map<string, CssResource>;
      iconById: Map<string, IconResource>;
      itemResources: (CardResource<Saved> | FileMetaResource)[];
      fullItemRoots: (CardResource<Saved> | FileMetaResource)[];
    },
    opts?: Options,
  ): Promise<EntryCollectionDocument> {
    let { htmlResources, cssById, iconById, itemResources, fullItemRoots } =
      resources;
    let included: EntryIncludedResource[] = [
      ...htmlResources,
      ...cssById.values(),
      ...iconById.values(),
      ...itemResources,
    ];

    if (fullItemRoots.length > 0 && opts?.loadLinks && !opts?.omitIncluded) {
      let omit = itemResources.map((r) => r.id).filter(Boolean) as string[];
      let runLoadLinks = () =>
        this.loadLinks(
          { realmURL: this.realmURL, rootResources: fullItemRoots, omit },
          opts,
        );
      let linked = opts?.timings
        ? await opts.timings.time('loadLinks', runLoadLinks)
        : await runLoadLinks();
      included.push(...linked);
    }

    if (included.length > 0) {
      doc.included = included;
    }
    await this.attachRealmInfo(doc);
    return doc;
  }

  async queryTargetsFileMeta(
    filter: Filter | undefined,
    opts?: Options,
  ): Promise<boolean> {
    if (!filter) {
      return false;
    }
    let refs: CodeRef[] = [];
    collectFilterRefs(filter, refs);
    let fileMatch = false;
    let instanceMatch = false;
    for (let ref of refs) {
      if (await this.#indexQueryEngine.hasFileType(this.realmURL, ref, opts)) {
        fileMatch = true;
      }
      if (
        await this.#indexQueryEngine.hasInstanceType(this.realmURL, ref, opts)
      ) {
        instanceMatch = true;
      }
    }
    return fileMatch && !instanceMatch;
  }

  async fetchCardTypeSummary() {
    let results = await this.#indexQueryEngine.fetchCardTypeSummary(
      new URL(this.#realm.url),
    );

    return results;
  }

  async getCardDependencies(url: URL): Promise<string[]> {
    let instance = await this.instance(url);
    if (!instance) {
      throw new Error(`Card not found: ${url.href}`);
    }
    if (instance.deps) {
      return instance.deps;
    }
    return [];
  }

  async cardDocument(
    url: URL,
    opts?: Options,
  ): Promise<SearchResult | undefined> {
    let doc: SingleCardDocument | undefined;
    let instance = await this.instance(url, opts);
    if (!instance) {
      return undefined;
    }
    if (instance.type === 'instance-error') {
      let scopedCssUrls = (instance.deps ?? []).filter(isScopedCSSRequest);
      return {
        type: 'error',
        error: {
          errorDetail: instance.error,
          scopedCssUrls,
          lastKnownGoodHtml: instance.isolatedHtml ?? null,
          cardTitle: instance.searchDoc?.cardTitle ?? null,
        },
      };
    }
    doc = {
      data: { ...instance.instance, ...{ links: { self: url.href } } },
    };
    if (!doc) {
      throw new Error(
        `bug: should never get here--search index doc is undefined`,
      );
    }
    if (opts?.loadLinks) {
      let included = await this.loadLinks(
        {
          realmURL: this.realmURL,
          rootResources: [doc.data],
          omit: [...(doc.data.id ? [doc.data.id] : [])],
        },
        opts,
      );
      if (included.length > 0) {
        doc.included = included;
      }
    }
    relativizeDocument(doc, this.realmURL, this.#realm.virtualNetwork);
    await this.attachRealmInfo(doc);
    return {
      type: 'doc',
      doc,
      generation: instance.generation,
      indexedAt: instance.indexedAt,
      deps: instance.deps,
    };
  }

  async instance(
    url: URL,
    opts?: QueryOptions,
  ): Promise<InstanceOrError | undefined> {
    return await this.#indexQueryEngine.getInstance(url, opts);
  }

  async file(url: URL, opts?: QueryOptions): Promise<IndexedFile | undefined> {
    return await this.#indexQueryEngine.getFile(url, opts);
  }

  private async populateQueryFields(
    resource: LooseCardResource | FileMetaResource,
    realmURL: URL,
    opts?: Options,
  ): Promise<void> {
    if (!resource.meta?.adoptsFrom) {
      return;
    }

    let relativeTo: RealmResourceIdentifier | URL = resource.id
      ? rri(resource.id)
      : realmURL;
    let codeRef = codeRefWithAbsoluteIdentifier(
      resource.meta.adoptsFrom,
      relativeTo,
      undefined,
      this.#realm.virtualNetwork,
    );
    if (!isResolvedCodeRef(codeRef)) {
      return;
    }
    let definition = await this.lookupDefinitionForOpts(codeRef, opts);
    if (!definition) {
      return;
    }
    await this.walkAndPopulateQueryFields(
      resource,
      definition,
      '',
      realmURL,
      opts,
      [
        internalKeyFor(
          definition.codeRef,
          undefined,
          this.#realm.virtualNetwork,
        ),
      ],
    );
  }

  // Walk the field tree from `definition` looking for computed
  // linksTo / linksToMany fields and running their queries. Recurses
  // through `contains` / `containsMany` of non-primitive fieldOrCards
  // because the new top-level-only `Definition.fields` shape no longer
  // pre-materializes nested paths. Visited-card-type counting matches
  // `getFieldDefinitions`'s `RECURSING_DEPTH = 3`-per-cycle policy so
  // the field set we visit matches the schema the host originally
  // emitted.
  private async walkAndPopulateQueryFields(
    resource: LooseCardResource | FileMetaResource,
    definition: import('./definitions.ts').Definition,
    prefix: string,
    realmURL: URL,
    opts: Options | undefined,
    visited: string[],
  ): Promise<void> {
    for (let [fieldName, defId] of Object.entries(definition.fields)) {
      let fieldDefinition = definition.fieldDefs[defId];
      if (!fieldDefinition) {
        continue;
      }
      let fullFieldName = prefix ? `${prefix}.${fieldName}` : fieldName;

      let queryDefinition = this.getQueryDefinition(fieldDefinition);
      if (
        queryDefinition &&
        (fieldDefinition.type === 'linksTo' ||
          fieldDefinition.type === 'linksToMany')
      ) {
        if (opts?.linkFields && !opts.linkFields.includes(fullFieldName)) {
          continue;
        }
        let { results, errors, searchURL } = await this.executeQueryForField({
          fieldDefinition,
          fieldName: fullFieldName,
          queryDefinition,
          resource,
          realmURL,
          opts,
        });
        this.applyQueryResults({
          fieldDefinition,
          fieldName: fullFieldName,
          resource,
          results,
          errors,
          searchURL,
        });
        continue;
      }

      if (
        fieldDefinition.isPrimitive ||
        (fieldDefinition.type !== 'contains' &&
          fieldDefinition.type !== 'containsMany')
      ) {
        continue;
      }
      if (!isResolvedCodeRef(fieldDefinition.fieldOrCard)) {
        continue;
      }
      let childCardKey = internalKeyFor(
        fieldDefinition.fieldOrCard,
        undefined,
        this.#realm.virtualNetwork,
      );
      if (visited.filter((v) => v === childCardKey).length > RECURSING_DEPTH) {
        continue;
      }
      let childDef = await this.lookupDefinitionForOpts(
        fieldDefinition.fieldOrCard,
        opts,
      );
      if (!childDef) {
        continue;
      }
      await this.walkAndPopulateQueryFields(
        resource,
        childDef,
        fullFieldName,
        realmURL,
        opts,
        [...visited, childCardKey],
      );
    }
  }

  private async lookupDefinitionForOpts(
    codeRef: import('./code-ref.ts').ResolvedCodeRef,
    opts: Options | undefined,
  ): Promise<import('./definitions.ts').Definition | undefined> {
    if (opts?.cacheOnlyDefinitions) {
      return await this.#definitionLookup.lookupCachedDefinition(codeRef);
    }
    return await this.#definitionLookup.lookupDefinition(codeRef, {
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
    });
  }

  // Populate query-based relationship fields using pre-extracted metadata
  // stored in the resource's meta during file indexing. This avoids a
  // runtime definition lookup (which could deadlock during prerendering).
  private async populateQueryFieldsFromMeta(
    resource: LooseCardResource | FileMetaResource,
    realmURL: URL,
    queryFieldDefs: Record<string, QueryFieldMeta>,
    opts?: Options,
  ): Promise<void> {
    for (let [fieldName, meta] of Object.entries(queryFieldDefs)) {
      if (opts?.linkFields && !opts.linkFields.includes(fieldName)) {
        continue;
      }
      let fieldDefinition: FieldDefinition = {
        type: meta.type,
        isPrimitive: false,
        isComputed: true,
        fieldOrCard: meta.fieldOrCard,
        query: meta.query,
      };
      let { results, errors, searchURL } = await this.executeQueryForField({
        fieldDefinition,
        fieldName,
        queryDefinition: meta.query,
        resource,
        realmURL,
        opts,
      });
      this.applyQueryResults({
        fieldDefinition,
        fieldName,
        resource,
        results,
        errors,
        searchURL,
      });
    }
  }

  private async executeQueryForField({
    fieldDefinition,
    fieldName,
    queryDefinition,
    resource,
    realmURL,
    opts,
  }: {
    fieldDefinition: FieldDefinition;
    fieldName: string;
    queryDefinition: Query;
    resource: LooseCardResource | FileMetaResource;
    realmURL: URL;
    opts?: Options;
  }): Promise<{
    results: (CardResource<Saved> | FileMetaResource)[];
    errors: QueryFieldErrorDetail[];
    searchURL: string;
  }> {
    let fieldPath = fieldName.includes('.')
      ? fieldName.slice(0, fieldName.lastIndexOf('.'))
      : '';
    // Resolved in RRI space (no VirtualNetwork): the target code ref keeps its
    // canonical spelling (prefix form for mapped realms), which the index
    // matches via its equivalent-spelling tolerance, and the resulting
    // `links.search` seed URL reconciles with the client's RRI-space rebuild
    // of the same query.
    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition,
      resource,
      realmURL,
      fieldName,
      fieldPath,
      resolvePathValue: (path) => getValueForResourcePath(resource, path),
    });
    if (!normalized) {
      return { results: [], errors: [], searchURL: '' };
    }

    let { query, realm } = normalized;
    let searchURL = buildQuerySearchURL(realm, query);
    let aggregated: (CardResource<Saved> | FileMetaResource)[] = [];
    let seen = new Set<string>();
    let errors: QueryFieldErrorDetail[] = [];

    let realmResults: (CardResource<Saved> | FileMetaResource)[] = [];
    if (realm === this.realmURL.href) {
      try {
        if (await this.queryTargetsFileMeta(query.filter, opts)) {
          let { files } = await this.#indexQueryEngine.searchFiles(
            this.realmURL,
            query,
            opts,
          );
          realmResults = files.map((fileEntry) =>
            fileResourceFromIndex(new URL(fileEntry.canonicalURL), fileEntry),
          );
        } else {
          let collection = await this.#indexQueryEngine.searchCards(
            this.realmURL,
            query,
            opts,
          );
          realmResults = Array.isArray(collection.cards)
            ? collection.cards
            : [];
        }
      } catch (err: unknown) {
        let message =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        errors.push({
          realm,
          type: 'unknown',
          message,
        });
        this.#log.debug(
          `query field "${fieldName}" on ${resource.id ?? '(unsaved card)'} failed to execute local search: ${message}`,
        );
      }
    } else {
      let remoteResult = await this.fetchRemoteQueryResults(realm, query);
      if (remoteResult.error) {
        errors.push(remoteResult.error);
        this.#log.debug(
          `query field "${fieldName}" on ${resource.id ?? '(unsaved card)'} failed querying realm ${realm}: ${remoteResult.error.message}`,
        );
      }
      realmResults = remoteResult.cards;
    }

    for (let result of realmResults) {
      if (!result?.id || seen.has(result.id)) {
        continue;
      }
      seen.add(result.id);
      aggregated.push(result);
    }

    if (
      aggregated.length === 0 &&
      errors.length > 0 &&
      errors.every((error) => error.type === 'authorization')
    ) {
      this.#log.warn(
        `query field "${fieldName}" on ${resource.id ?? '(unsaved card)'} returned no results because the realm query was unauthorized`,
      );
    }

    return { results: aggregated, errors, searchURL };
  }

  private getQueryDefinition(
    fieldDefinition: FieldDefinition,
  ): Query | undefined {
    if (fieldDefinition.query && typeof fieldDefinition.query === 'object') {
      return fieldDefinition.query as Query;
    }
    return undefined;
  }

  private applyQueryResults({
    fieldDefinition,
    fieldName,
    resource,
    results,
    errors,
    searchURL,
  }: {
    fieldDefinition: FieldDefinition;
    fieldName: string;
    resource: LooseCardResource | FileMetaResource;
    results: (CardResource<Saved> | FileMetaResource)[];
    errors: QueryFieldErrorDetail[];
    searchURL: string;
  }): void {
    resource.relationships = resource.relationships ?? {};
    for (let key of Object.keys(resource.relationships)) {
      if (key === fieldName || key.startsWith(`${fieldName}.`)) {
        delete resource.relationships[key];
      }
    }

    let errorMeta =
      errors.length > 0
        ? {
            errors: errors.map((error) => ({
              realm: error.realm,
              type: error.type,
              message: error.message,
              ...(error.status != null ? { status: error.status } : {}),
            })),
          }
        : undefined;

    if (fieldDefinition.type === 'linksTo') {
      let first = results[0];
      let relationshipLinks: Record<string, string | null> = {
        ...(searchURL ? { search: searchURL } : {}),
      };
      let relationship: {
        links: Record<string, string | null>;
        data?: { type: string; id: string } | null;
        meta?: typeof errorMeta;
      } = {
        links: relationshipLinks,
        ...(errorMeta ? { meta: errorMeta } : {}),
      };
      if (first && first.id) {
        relationship.links.self = first.id;
        if (searchURL) {
          relationship.data = { type: first.type ?? 'card', id: first.id };
        }
      } else {
        relationship.links.self = null;
        if (searchURL) {
          relationship.data = null;
        }
      }
      resource.relationships[fieldName] = relationship;
      return;
    }

    let baseRelationshipLinks: Record<string, string | null> = {
      ...(searchURL ? { search: searchURL } : {}),
    };
    if (!('self' in baseRelationshipLinks)) {
      baseRelationshipLinks.self = null;
    }

    let relationshipData =
      searchURL !== ''
        ? results
            .filter(
              (card): card is CardResource<Saved> & { id: string } =>
                typeof card.id === 'string',
            )
            .map((card) => ({ type: card.type ?? 'card', id: card.id }))
        : undefined;

    resource.relationships[fieldName] = {
      links: baseRelationshipLinks,
      ...(relationshipData !== undefined ? { data: relationshipData } : {}),
      ...(errorMeta ? { meta: errorMeta } : {}),
    };

    results.forEach((card, index) => {
      if (!card.id) {
        return;
      }
      resource.relationships![`${fieldName}.${index}`] = {
        links: { self: card.id },
        data: { type: card.type ?? 'card', id: card.id },
      };
    });
  }

  private async fetchRemoteQueryResults(
    realmHref: string,
    query: Query,
  ): Promise<{
    cards: (CardResource<Saved> | FileMetaResource)[];
    error?: QueryFieldErrorDetail;
  }> {
    try {
      let searchURL = buildQuerySearchURL(realmHref, query);
      let { realm, realms, ...queryWithoutRealm } = query as Query & {
        realm?: string;
        realms?: string[];
      };
      let realmList = realms ?? (realm ? [realm] : [realmHref]);
      // Resolve the cross-realm query-backed field against the peer realm's
      // `/_search` endpoint, data-only: the legacy card-rooted query
      // translates to the entry wire grammar, and the `item` fieldset
      // makes every entry carry its full `card`/`file-meta` serialization.
      let wireQuery = searchEntryWireQueryFromQuery(
        queryWithoutRealm as Query,
        {
          fields: ['item'],
        },
      );
      let response = await this.#fetch(searchURL, {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
        },
        body: JSON.stringify({ ...wireQuery, realms: realmList }),
      });
      if (!response.ok) {
        let type: QueryFieldErrorType =
          response.status === 401 || response.status === 403
            ? 'authorization'
            : 'network';
        let statusMessage = `${response.status}${
          response.statusText ? ` ${response.statusText}` : ''
        }`;
        return {
          cards: [],
          error: {
            realm: realmHref,
            type,
            status: response.status,
            message: `HTTP ${statusMessage}`,
          },
        };
      }
      let json = await response.json();
      if (!isEntryCollectionDocument(json)) {
        return {
          cards: [],
          error: {
            realm: realmHref,
            type: 'unknown',
            message: 'remote realm returned unexpected payload',
          },
        };
      }
      // The matched instances ride in `included` as `card`/`file-meta`
      // resources, reached through each entry's `item` relationship; recover
      // them in entry (sorted) order — the linked resources this field
      // resolves to.
      let itemsByIdentity = new Map<
        string,
        CardResource<Saved> | FileMetaResource
      >();
      for (let resource of json.included ?? []) {
        if (
          (resource.type === CardResourceType ||
            resource.type === FileMetaResourceType) &&
          resource.id
        ) {
          itemsByIdentity.set(
            resourceIdentity(resource.type, resource.id),
            resource,
          );
        }
      }
      let cards: (CardResource<Saved> | FileMetaResource)[] = [];
      for (let entry of json.data) {
        let ref = entry.relationships.item?.data;
        if (!ref) {
          continue;
        }
        let item = itemsByIdentity.get(resourceIdentity(ref.type, ref.id));
        if (item) {
          cards.push(item);
        }
      }
      return { cards };
    } catch (err: unknown) {
      let message =
        err instanceof Error ? err.message : String(err ?? 'unknown error');
      return {
        cards: [],
        error: {
          realm: realmHref,
          type: 'network',
          message,
        },
      };
    }
  }

  private async attachRealmInfo(
    doc: SingleCardDocument | EntryCollectionDocument,
  ): Promise<void> {
    let realmInfo = await this.#realm.getRealmInfo();
    let resources = Array.isArray(doc.data) ? doc.data : [doc.data];
    for (let resource of [...resources, ...(doc.included ?? [])]) {
      // Only `card` / `file-meta` resources carry realm metadata. An entry
      // `included` also holds `html` / `css` / `icon` resources, which have no
      // `realmURL`; they fall through this discriminant untouched.
      if (
        resource.type !== CardResourceType &&
        resource.type !== FileMetaResourceType
      ) {
        continue;
      }
      if (resource.meta?.realmURL === this.realmURL.href) {
        resource.meta.realmInfo = realmInfo;
      }
    }
  }

  private async fetchCrossRealmLinks(
    urls: string[],
    invocationId: string,
    layerIndex: number,
    linkContext?: Map<string, { fieldName: string }>,
  ): Promise<Map<string, CardResource<Saved> | FileMetaResource>> {
    let entries = await Promise.all(
      urls.map(async (url) => {
        let response: Response;
        // A file link (the URL ends in a known FileDef extension; card ids
        // never do) is requested with the file-meta mime so the serving
        // realm returns the index-enriched document — consumers rely on
        // index-derived attributes like a markdown skill's `kind`, which
        // the card-mime fallback for file paths omits.
        let accept = urlNamesFile(new URL(url))
          ? SupportedMimeType.FileMeta
          : SupportedMimeType.CardJson;
        try {
          response = await this.#fetch(url, {
            headers: { Accept: accept },
          });
        } catch (err: unknown) {
          let message =
            err instanceof Error ? err.message : String(err ?? 'unknown');
          this.#log.warn(
            `[loadLinks ${invocationId}] layer=${layerIndex} cross-realm fetch threw for ${url}: ${message}`,
          );
          throw err;
        }
        if (!response.ok) {
          this.#log.warn(
            `[loadLinks ${invocationId}] layer=${layerIndex} cross-realm fetch failed for ${url} status=${response.status}`,
          );
          throw await CardError.fromFetchResponse(url, response);
        }
        // `links.self` should resolve to a card or file document, but a
        // mistake (human or AI-generated) can leave a non-card URL here.
        // Gate on Content-Type so a binary body never reaches JSON.parse.
        let contentType = response.headers.get('content-type');
        if (!isJsonContentType(contentType)) {
          let fieldName = linkContext?.get(url)?.fieldName;
          let fieldLabel = fieldName
            ? `Relationship \`${fieldName}\``
            : 'A relationship';
          throw new Error(
            `${fieldLabel} links to a non-card URL (${
              contentType ?? 'unknown content type'
            }): ${url}. The link should resolve to a card or file document; it likely points at a binary resource (e.g. an image) instead.`,
          );
        }
        let json = await response.json();
        // Cross-realm links can target either a card or a file (e.g. a card
        // instantiated from a catalog still links to the catalog's image
        // file). Both kinds are valid linked resources; only an unrecognized
        // payload is an error.
        if (isSingleCardDocument(json) || isSingleFileMetaDocument(json)) {
          let linkResource: CardResource<Saved> | FileMetaResource = {
            ...json.data,
            ...{ links: { self: json.data.id } },
          };
          return [url, linkResource] as const;
        }
        throw new Error(
          `linked resource ${url} is not a card or file document. it is: ${JSON.stringify(
            json,
            null,
            2,
          )}`,
        );
      }),
    );
    return new Map(entries);
  }

  // TODO The caller should provide a list of fields to be included via JSONAPI
  // request. currently we just use the maxLinkDepth to control how deep to load
  // links.
  //
  // Level-order BFS: each layer issues at most one batched DB query for
  // in-realm cards and one for in-realm file-meta resources, alongside
  // Promise.all-fanout cross-realm fetches, all running concurrently
  // regardless of how many siblings reference links at that depth.
  private async loadLinks(
    {
      realmURL,
      rootResources,
      omit = [],
      included = [],
    }: {
      realmURL: URL;
      rootResources: (LooseCardResource | FileMetaResource)[];
      omit?: string[];
      included?: (CardResource<Saved> | FileMetaResource)[];
    },
    opts?: Options,
  ): Promise<(CardResource<Saved> | FileMetaResource)[]> {
    // Diagnostic correlation id — lets us match log lines from the same
    // loadLinks invocation across layers when investigating CI failures.
    let invocationId = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let vnForIdentity = this.#realm.virtualNetwork;
    let realmPath = new RealmPaths(realmURL, vnForIdentity);
    // `omit`/root ids may arrive in either resolved-URL or registered-alias
    // form (the entry's item resource id is always resolved, while a
    // fetched linked resource's own pristine_doc-derived id — and the
    // relationship pointing at it, `relationshipIdStr` below — stays in
    // alias form for storage portability). `equivalentURLForms` only
    // enumerates spellings of a *resolved* URL, so an alias-form input needs
    // `toURLHref` first to reach the resolved form it can expand from;
    // `toURLHref` is a no-op on an input that's already a resolved URL.
    // Index every spelling under one key so a root recognized via one form
    // still matches when the same card is reached again via another.
    let allIdForms = (id: string) =>
      vnForIdentity.equivalentURLForms(vnForIdentity.toURLHref(id));
    let omitSet = new Set(omit.flatMap((id) => allIdForms(id)));
    let visited = new Set<string>();
    // Mirror the id of every resource in included[] so dedup is O(1): the
    // relationship-target check (per entry) and the pre-push check (per
    // resource) are Set lookups rather than linear scans of an array that
    // grows to the full transitive-closure size.
    let includedIds = new Set<string>();
    for (let existing of included) {
      if (existing.id != null) {
        includedIds.add(existing.id);
      }
    }

    type LayerItem = {
      resource: LooseCardResource | FileMetaResource;
      stack: string[];
      applyLinkFields: boolean;
      // Roots are returned in doc.data; everything else gets cloned and
      // pushed onto included[] *after* its relationships are rewritten in
      // its own layer (preserving the original implementation's order: the
      // recursive caller cloned a resource only after the recursive call
      // had already mutated its relationship.data fields).
      isRoot: boolean;
    };
    let layer: LayerItem[] = [];
    for (let resource of rootResources) {
      if (resource.id != null) {
        if (visited.has(resource.id)) {
          continue;
        }
        for (let form of allIdForms(resource.id)) {
          visited.add(form);
        }
      }
      layer.push({
        resource,
        stack: [],
        applyLinkFields: !!opts?.linkFields,
        isRoot: true,
      });
    }

    this.#log.debug(
      `[loadLinks ${invocationId}] start realm=${realmURL.href} roots=${layer.length} omit=${omitSet.size} linkFields=${opts?.linkFields?.length ?? 'none'}`,
    );

    let layerIndex = 0;
    while (layer.length > 0) {
      // Bail before each layer's batched DB queries + cross-realm fetches if
      // the search's time budget has fired, so an over-budget item-leg search
      // stops here rather than expanding the full transitive closure. The
      // federated fan-out treats the resulting rejection as a failed realm; the
      // handler's time-budget race is what actually returns the 408.
      opts?.signal?.throwIfAborted();
      let currentLayerIndex = layerIndex++;
      // Step 1: run populateQueryFields for every resource in this layer in
      // parallel. Each runs an independent searchCards query for its
      // computed query-fields; collapsing those across the layer is a
      // separate optimization.
      try {
        await Promise.all(
          layer.map(async ({ resource, applyLinkFields }) => {
            let popOpts = applyLinkFields
              ? opts
              : opts?.linkFields
                ? { ...opts, linkFields: undefined }
                : opts;
            let timings = popOpts?.timings;
            let storedDefs = (
              resource.meta as {
                queryFieldDefs?: Record<string, QueryFieldMeta>;
              }
            )?.queryFieldDefs;
            // The relationship/query-field assembly — the definition lookup +
            // field-tree walk — is the post-SQL "wire-format prep" the timeline
            // attributes under `populate`. Recorded as busy-time (this runs
            // concurrently across the layer); the wall-clock of the whole pass
            // is the outer `loadLinks` stage.
            let runPopulate = () =>
              popOpts?.cacheOnlyDefinitions && storedDefs
                ? this.populateQueryFieldsFromMeta(
                    resource,
                    realmURL,
                    storedDefs,
                    popOpts,
                  )
                : this.populateQueryFields(resource, realmURL, popOpts);
            if (timings) {
              await timings.busyTime('populate', runPopulate);
            } else {
              await runPopulate();
            }
          }),
        );
      } catch (err: unknown) {
        // Surface the failing resource in the log; an unowned rejection
        // here was a strong candidate for the "A network error occurred"
        // teardown failures observed during the CS-11038 investigation.
        let message =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        this.#log.warn(
          `[loadLinks ${invocationId}] layer=${currentLayerIndex} populateQueryFields rejected for layer of ${layer.length} resource(s): ${message}`,
        );
        throw err;
      }

      // Step 1b: strip `fieldName.N` sub-entries from query-backed fields.
      // The host deserializer treats every per-item entry as a
      // follow-able relationship and expects its target in `included[]`,
      // so leaving them on the wire alongside a query-backed field whose
      // targets are not expanded into `included[]` produces orphan-link
      // errors. The umbrella entry (`fieldName`) stays — it carries
      // `links.search` and `data: [array of IDs]` for the host's per-URL
      // hydration path. Set by the card-document prerender path
      // (`skipQueryBackedExpansion`).
      if (opts?.skipQueryBackedExpansion) {
        for (let { resource } of layer) {
          if (!resource.relationships) {
            continue;
          }
          for (let fieldName of Object.keys(resource.relationships)) {
            let umbrella = resource.relationships[fieldName];
            if (
              !umbrella ||
              Array.isArray(umbrella) ||
              !umbrella.links?.search
            ) {
              continue;
            }
            for (let key of Object.keys(resource.relationships)) {
              if (key !== fieldName && key.startsWith(`${fieldName}.`)) {
                delete resource.relationships[key];
              }
            }
          }
        }
      }

      // Step 2: walk every resource's relationships, classify each link,
      // and accumulate URL sets for the batched DB queries.
      type Entry = {
        item: LayerItem;
        relationship: import('./resource-types.ts').Relationship;
        linkURL: URL;
        relationshipId: URL;
        relationshipIdStr: string;
        relationshipType:
          | typeof CardResourceType
          | typeof FileMetaResourceType
          | undefined;
        expectsCard: boolean;
        expectsFileMeta: boolean;
        inRealm: boolean;
      };
      let entries: Entry[] = [];
      let inRealmCardURLs = new Set<string>();
      let inRealmFileURLs = new Set<string>();
      let crossRealmURLs = new Set<string>();
      // Maps each cross-realm URL to the field that produced it, so a
      // non-card link can name the offending field in its error.
      let crossRealmFieldNames = new Map<string, { fieldName: string }>();

      for (let item of layer) {
        let { resource, applyLinkFields } = item;
        let activeOpts = applyLinkFields
          ? opts
          : opts?.linkFields
            ? { ...opts, linkFields: undefined }
            : opts;
        let processed = new Set<string>();

        for (let entry of relationshipEntries(resource.relationships)) {
          let { relationship, key, fieldName } = entry;
          if (processed.has(key)) {
            continue;
          }
          if (
            activeOpts?.linkFields &&
            !activeOpts.linkFields.includes(fieldName)
          ) {
            continue;
          }
          if (activeOpts?.skipQueryBackedExpansion) {
            // applyQueryResults is the only writer of
            // `umbrella.links.search`, so its presence on the
            // top-level field umbrella means this field is
            // query-backed. Skip all `${fieldName}` and
            // `${fieldName}.N` entries in this case — they're
            // populated and serialized as relationship data, but the
            // linked resources are not added to `included[]`. The
            // prerender caller materializes them via per-URL fetches.
            let umbrella = resource.relationships?.[fieldName];
            if (
              umbrella &&
              !Array.isArray(umbrella) &&
              umbrella.links?.search
            ) {
              continue;
            }
          }
          if (!relationship.links?.self) {
            continue;
          }
          if (Array.isArray(relationship.data)) {
            throw new Error(
              `bug: relationship ${key} cannot be a list when loading links`,
            );
          }
          processed.add(key);

          let vn = this.#realm.virtualNetwork;
          let linkURL = vn.resolveURL(
            relationship.links.self,
            resource.id ? vn.toURL(resource.id) : realmURL,
          );

          let relationshipType = relationship.data?.type as
            | typeof CardResourceType
            | typeof FileMetaResourceType
            | undefined;
          // Card ids never end in a known FileDef extension, so the URL
          // itself says whether the link targets a file. That also corrects
          // stale index payloads which record file relationships as type
          // "card" (or omit the type) when linked files were indexed after
          // instances.
          let expectsFileMeta =
            relationshipType === FileMetaResourceType || urlNamesFile(linkURL);
          let expectsCard =
            relationshipType === CardResourceType && !expectsFileMeta;
          let resolvedSelf: string;
          try {
            // Resolve the base to a real URL first: `resource.id` may be a
            // canonical RRI (mapped realm), which `resolveURL` only accepts as
            // a base for a registered prefix — `toURL` yields the fetchable URL
            // either form. Mirrors the `linkURL` base above.
            resolvedSelf = vn.resolveURL(
              relationship.links.self,
              resource.id ? vn.toURL(resource.id) : realmURL,
            ).href;
          } catch {
            throw new Error(
              `bug: unable to turn relative URL '${relationship.links.self}' into an absolute URL relative to ${resource.id}`,
            );
          }
          let relationshipId = maybeURL(resolvedSelf);
          if (!relationshipId) {
            throw new Error(
              `bug: unable to turn relative URL '${relationship.links.self}' into an absolute URL relative to ${resource.id}`,
            );
          }
          // Use prefix form (e.g. @cardstack/catalog/...) when available
          // so relationship data.id stays portable across environments.
          let relationshipIdStr = vn.unresolveURL(relationshipId.href);

          let inRealm = realmPath.inRealm(linkURL);
          if (inRealm) {
            if (expectsCard || (!relationshipType && !expectsFileMeta)) {
              inRealmCardURLs.add(linkURL.href);
            }
            if (expectsFileMeta) {
              inRealmFileURLs.add(linkURL.href);
            }
          } else {
            crossRealmURLs.add(linkURL.href);
            if (!crossRealmFieldNames.has(linkURL.href)) {
              crossRealmFieldNames.set(linkURL.href, { fieldName });
            }
          }

          entries.push({
            item,
            relationship,
            linkURL,
            relationshipId,
            relationshipIdStr,
            relationshipType,
            expectsCard,
            expectsFileMeta,
            inRealm,
          });
        }
      }

      this.#log.debug(
        `[loadLinks ${invocationId}] layer=${currentLayerIndex} size=${layer.length} entries=${entries.length} inRealmCards=${inRealmCardURLs.size} inRealmFiles=${inRealmFileURLs.size} crossRealm=${crossRealmURLs.size}`,
      );

      // Step 3: issue this layer's batched DB queries plus cross-realm
      // fetches concurrently. In-realm links collapse to one batched query
      // per kind (instances + file-meta); cross-realm links fan out one
      // fetch per unique URL via Promise.all alongside the DB round-trips.
      let batchStart = Date.now();
      let instanceMap: Map<string, InstanceOrError>;
      let fileMap: Map<string, IndexedFile>;
      let crossRealmMap: Map<string, CardResource<Saved> | FileMetaResource>;
      try {
        [instanceMap, fileMap, crossRealmMap] = await Promise.all([
          inRealmCardURLs.size > 0
            ? this.#indexQueryEngine.getInstances(
                [...inRealmCardURLs].map((u) => new URL(u)),
                opts,
              )
            : Promise.resolve(new Map<string, InstanceOrError>()),
          inRealmFileURLs.size > 0
            ? this.#indexQueryEngine.getFiles(
                [...inRealmFileURLs].map((u) => new URL(u)),
                opts,
              )
            : Promise.resolve(new Map<string, IndexedFile>()),
          crossRealmURLs.size > 0
            ? this.fetchCrossRealmLinks(
                [...crossRealmURLs],
                invocationId,
                currentLayerIndex,
                crossRealmFieldNames,
              )
            : Promise.resolve(
                new Map<string, CardResource<Saved> | FileMetaResource>(),
              ),
        ]);
      } catch (err: unknown) {
        let message =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        this.#log.warn(
          `[loadLinks ${invocationId}] layer=${currentLayerIndex} batched index lookup rejected (cards=${inRealmCardURLs.size} files=${inRealmFileURLs.size} crossRealm=${crossRealmURLs.size}): ${message}`,
        );
        throw err;
      }
      this.#log.debug(
        `[loadLinks ${invocationId}] layer=${currentLayerIndex} batch fetched in ${Date.now() - batchStart}ms instances=${instanceMap.size}/${inRealmCardURLs.size} files=${fileMap.size}/${inRealmFileURLs.size} crossRealm=${crossRealmMap.size}/${crossRealmURLs.size}`,
      );

      // Step 4: per-entry — resolve linkResource from the prefetched
      // maps (in-realm or cross-realm), build the next layer, and
      // rewrite relationship.data with the same semantics as the
      // original recursive implementation.
      let nextLayer: LayerItem[] = [];
      for (let entry of entries) {
        let linkResource: CardResource<Saved> | FileMetaResource | undefined;

        if (entry.inRealm) {
          if (
            entry.expectsCard ||
            (!entry.relationshipType && !entry.expectsFileMeta)
          ) {
            let maybeResult = instanceMap.get(entry.linkURL.href);
            if (maybeResult?.type === 'instance') {
              linkResource = maybeResult.instance;
            }
          }
          if (!linkResource && entry.expectsFileMeta) {
            let fileEntry = fileMap.get(entry.linkURL.href);
            if (fileEntry) {
              linkResource = fileResourceFromIndex(entry.linkURL, fileEntry);
            }
          }
        } else {
          linkResource = crossRealmMap.get(entry.linkURL.href);
        }

        let descendStack =
          entry.item.resource.id != null
            ? [entry.item.resource.id, ...entry.item.stack]
            : entry.item.stack;

        // TODO stop using maxLinkDepth. we should save the JSON-API doc
        // in the index based on keeping track of the rendered fields
        // and invalidate the index as consumed cards change.
        //
        // Gate uses the CURRENT item's stack length (ancestors only),
        // matching the original recursive `stack.length <= maxLinkDepth`
        // check which ran before pushing the current resource onto the
        // stack for the recursive call. Using descendStack.length here
        // would cut traversal off one level early.
        let foundLinks = false;
        if (linkResource && entry.item.stack.length <= maxLinkDepth) {
          let alreadyVisited =
            linkResource.id != null && visited.has(linkResource.id);
          if (!alreadyVisited) {
            if (linkResource.id != null) {
              visited.add(linkResource.id);
            }
            // Schedule expansion at the next layer. linkFields applies
            // only at the root layer; nested relationships are fully
            // loaded up to maxLinkDepth. The clone+push to included[]
            // happens at the END of that layer's processing — once the
            // resource's relationships have been rewritten — so the
            // clone captures the mutations rather than the pre-rewrite
            // state from pristine_doc.
            nextLayer.push({
              resource: linkResource,
              stack: descendStack,
              applyLinkFields: false,
              isRoot: false,
            });
            foundLinks = true;
          } else if (linkResource.id != null) {
            // Already visited — either a root (in omit) or scheduled for
            // inclusion at the end of its own processing layer. Either way
            // it's part of our doc, so relationship.data still gets
            // rewritten below.
            foundLinks = true;
          }
        }

        if (
          foundLinks ||
          omitSet.has(entry.relationshipIdStr) ||
          includedIds.has(entry.relationshipIdStr)
        ) {
          entry.relationship.data = {
            type: linkResource?.type ?? CardResourceType,
            id: entry.relationshipIdStr,
          };
        } else if (!linkResource) {
          // Even when the linked resource is unavailable, ensure
          // relationship.data has the correct type so stale pristine_doc
          // entries (missing data.type) for file relationships are not
          // misidentified as card links.
          let fallbackRelationshipType:
            | typeof CardResourceType
            | typeof FileMetaResourceType;
          if (entry.expectsFileMeta) {
            fallbackRelationshipType = FileMetaResourceType;
          } else {
            fallbackRelationshipType =
              entry.relationshipType ?? CardResourceType;
          }
          entry.relationship.data = {
            type: fallbackRelationshipType,
            id: entry.relationshipId.href,
          };
        }
      }

      // Step 5: clone+absolutize each non-root layer item and push it onto
      // included[]. Doing this AFTER step 4 ensures the cloned snapshot
      // reflects any relationship.data rewrites we just applied to the
      // resource (matching the original recursive implementation, which
      // cloned in the parent's loop only after the recursive call had
      // mutated the child's relationships).
      for (let item of layer) {
        if (item.isRoot) {
          continue;
        }
        // Non-root items always originate from the batched index lookup
        // (which returns CardResource<Saved>) or a cross-realm fetch (which
        // is normalized to the same shape), so the runtime type is always
        // strictly assignable to included[].
        let resource = item.resource as CardResource<Saved> | FileMetaResource;
        if (resource.id == null) {
          continue;
        }
        if (omitSet.has(resource.id)) {
          continue;
        }
        if (includedIds.has(resource.id)) {
          continue;
        }
        let rewritten = cloneDeep({
          ...resource,
          ...{ links: { self: resource.id } },
        });
        visitInstanceURLs(rewritten, (url, setURL) =>
          absolutizeInstanceURL(
            url,
            rewritten.id,
            setURL,
            this.#realm.virtualNetwork,
          ),
        );
        visitModuleDeps(rewritten, (url, setURL) =>
          absolutizeInstanceURL(
            url,
            rewritten.id,
            (newURL) => setURL(newURL as RealmResourceIdentifier),
            this.#realm.virtualNetwork,
          ),
        );
        included.push(rewritten);
        includedIds.add(resource.id);
      }

      layer = nextLayer;
    }

    this.#log.debug(
      `[loadLinks ${invocationId}] complete layers=${layerIndex} included=${included.length} visited=${visited.size}`,
    );
    return included;
  }
}

function collectFilterRefs(filter: Filter, refs: CodeRef[]) {
  let filterWithType = filter as { type?: CodeRef; on?: CodeRef };
  if (filterWithType.type) {
    refs.push(filterWithType.type);
  }
  if (filterWithType.on) {
    refs.push(filterWithType.on);
  }
  if ('every' in filter) {
    filter.every.forEach((inner) => collectFilterRefs(inner, refs));
  }
  if ('any' in filter) {
    filter.any.forEach((inner) => collectFilterRefs(inner, refs));
  }
  if ('not' in filter) {
    collectFilterRefs(filter.not, refs);
  }
}

// Exported for testing (CS-10498 regression test)
export function relativizeDocument(
  doc: SingleCardDocument,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
): void {
  let primarySelf = doc.data.links?.self ?? doc.data.id;
  if (!primarySelf) {
    return;
  }
  let primaryURL = new URL(primarySelf);
  relativizeResource(
    doc.data as unknown as LooseCardResource,
    primaryURL,
    realmURL,
    virtualNetwork,
  );
  if (doc.included) {
    for (let resource of doc.included) {
      relativizeResource(
        resource as unknown as LooseCardResource,
        primaryURL,
        realmURL,
        virtualNetwork,
      );
    }
  }
}

// A reference in scoped RRI form (e.g. `@cardstack/base/card-api`) is an
// absolute cross-realm identifier and must never be treated as realm-relative.
// Registered prefixes are a subset, but a scoped reference to a realm this
// VirtualNetwork does not know is still scoped — the leading `@` is the signal.
function isScopedReference(
  reference: string,
  virtualNetwork: VirtualNetwork,
): boolean {
  return (
    reference.startsWith('@') || virtualNetwork.isRegisteredPrefix(reference)
  );
}

function relativizeResource(
  resource: LooseCardResource,
  primaryURL: URL,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
) {
  // resource.id may be a registered prefix (e.g. @cardstack/openrouter/...)
  // which is not a valid URL base. Resolve it to a URL for relative resolution.
  let resourceURL = resource.id
    ? virtualNetwork.toURL(resource.id)
    : primaryURL;
  visitInstanceURLs(resource, (url, setURL) => {
    // Scoped RRIs (e.g. @cardstack/catalog/foo) are already in their canonical
    // portable form — don't resolve or relativize them. A scoped reference is
    // absolute and cross-realm by construction, so it is preserved verbatim
    // whether or not this VirtualNetwork has a mapping registered for its
    // prefix (an index engine for one realm need not know every other realm).
    if (isScopedReference(url, virtualNetwork)) {
      return;
    }
    let urlObj = virtualNetwork.resolveURL(url, resourceURL);
    setURL(maybeRelativeReference(urlObj, primaryURL, realmURL));
  });
  visitModuleDeps(resource, (moduleURL, setModuleURL) => {
    // Scoped RRIs are already in canonical portable form — see the note in the
    // instance-URL visitor above.
    if (isScopedReference(moduleURL, virtualNetwork)) {
      return;
    }
    let absoluteModuleURL = virtualNetwork.resolveURL(moduleURL, resourceURL);
    setModuleURL(
      maybeRelativeReference(
        absoluteModuleURL,
        primaryURL,
        realmURL,
      ) as RealmResourceIdentifier,
    );
  });
}

// Resolve a row's `icon` (type-descriptor) resource id — its native-type
// internal key — and register the deduped resource carrying the type's icon,
// display name, and code ref. Returns the id to hang the `entry` →
// `icon` relationship on, or undefined when the row has no native type, no
// `icon_html`, or an unparseable internal key. The same internal key collapses
// every result of that type to one resource in `included`.
function collectIconId(
  nativeKey: string | undefined,
  iconHtml: string | undefined,
  displayName: string,
  iconById: Map<string, IconResource>,
): string | undefined {
  if (!nativeKey || !iconHtml) {
    return undefined;
  }
  let codeRef = codeRefFromInternalKey(nativeKey);
  if (!codeRef) {
    return undefined;
  }
  if (!iconById.has(nativeKey)) {
    iconById.set(
      nativeKey,
      buildIconResource({
        internalKey: nativeKey,
        iconHtml,
        displayName,
        codeRef,
      }),
    );
  }
  return nativeKey;
}

// One candidate rendering of a row, with its markup: a (format, renderType)
// point in the rendering set the renderSet projection selects. The
// fitted/embedded JSONB maps contribute one candidate per render-type key;
// the scalar atom/head columns contribute one candidate at the row's own
// native type.
type RowRendering = RenderingCandidate & { html: string };

function enumerateRowRenderings(row: {
  fitted_html?: Record<string, string> | null;
  embedded_html?: Record<string, string> | null;
  atom_html?: string | null;
  head_html?: string | null;
  types?: string[] | null;
}): RowRendering[] {
  let candidates: RowRendering[] = [];
  for (let [format, byType] of [
    ['fitted', row.fitted_html],
    ['embedded', row.embedded_html],
  ] as const) {
    for (let [renderTypeKey, html] of Object.entries(byType ?? {})) {
      if (html != null) {
        candidates.push({ format, renderTypeKey, html });
      }
    }
  }
  let nativeKey = row.types?.[0];
  if (row.atom_html != null) {
    candidates.push({
      format: 'atom',
      ...(nativeKey ? { renderTypeKey: nativeKey } : {}),
      html: row.atom_html,
    });
  }
  if (row.head_html != null) {
    candidates.push({
      format: 'head',
      ...(nativeKey ? { renderTypeKey: nativeKey } : {}),
      html: row.head_html,
    });
  }
  return candidates;
}

// The file counterpart: a file renders natively, so its fitted/embedded
// candidates come from its own type's entry and no candidate carries a
// renderTypeKey (a renderType predicate in the htmlQuery never matches a
// file rendering).
function enumerateFileRenderings(file: IndexedFile): RowRendering[] {
  let candidates: RowRendering[] = [];
  let nativeKey = file.types?.[0];
  for (let [format, byType] of [
    ['fitted', file.fittedHtml],
    ['embedded', file.embeddedHtml],
  ] as const) {
    let html = nativeKey != null ? byType?.[nativeKey] : undefined;
    if (html != null) {
      candidates.push({ format, html });
    }
  }
  if (file.atomHtml != null) {
    candidates.push({ format: 'atom', html: file.atomHtml });
  }
  if (file.headHtml != null) {
    candidates.push({ format: 'head', html: file.headHtml });
  }
  return candidates;
}

function fileResourceFromIndex(
  fileURL: URL,
  fileEntry: IndexedFile,
): FileMetaResource {
  let name = fileURL.pathname.split('/').pop() ?? fileURL.pathname;
  let inferredContentType = inferContentType(name);
  let searchDoc = fileEntry.searchDoc ?? {};
  let contentHash =
    typeof searchDoc.contentHash === 'string'
      ? searchDoc.contentHash
      : undefined;
  let lastModified = fileEntry.lastModified ?? unixTime(Date.now());
  let createdAt = fileEntry.resourceCreatedAt ?? lastModified;
  let adoptsFrom =
    codeRefFromInternalKey(fileEntry.types?.[0]) ??
    (isCodeRef(fileEntry.resource?.meta?.adoptsFrom)
      ? fileEntry.resource?.meta?.adoptsFrom
      : {
          module: `${baseRealmRRI}card-api`,
          name: 'FileDef',
        });
  let resourceAttributes = fileEntry.resource?.attributes ?? {};
  let baseAttributes = {
    name: resourceAttributes.name ?? searchDoc.name ?? name,
    url: resourceAttributes.url ?? searchDoc.url ?? fileURL.href,
    sourceUrl:
      resourceAttributes.sourceUrl ?? searchDoc.sourceUrl ?? fileURL.href,
    contentType:
      resourceAttributes.contentType ??
      searchDoc.contentType ??
      inferredContentType,
    contentHash: resourceAttributes.contentHash ?? contentHash,
    lastModified,
    createdAt,
  };
  let attributes: Record<string, unknown> = { ...baseAttributes };
  for (let [key, value] of Object.entries(resourceAttributes)) {
    if (value !== undefined && !(key in attributes)) {
      attributes[key] = value;
    }
  }
  for (let [key, value] of Object.entries(searchDoc)) {
    if (
      key in baseAttributes ||
      FILE_META_RESERVED_KEYS.has(key) ||
      value === undefined
    ) {
      continue;
    }
    attributes[key] = value;
  }
  return {
    id: fileURL.href as RealmResourceIdentifier,
    type: 'file-meta',
    attributes: {
      ...attributes,
    },
    meta: {
      adoptsFrom: adoptsFrom as CodeRef,
      realmURL: fileEntry.realmURL as RealmIdentifier,
    },
    links: { self: fileURL.href },
  };
}
