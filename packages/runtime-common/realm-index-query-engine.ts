import { Memoize } from 'typescript-memoize';
import { isScopedCSSRequest } from './scoped-css';
import cloneDeep from 'lodash/cloneDeep';
import {
  SupportedMimeType,
  isJsonContentType,
  baseRealm,
  inferContentType,
  unixTime,
  maxLinkDepth,
  maybeURL,
  resolveCardReference,
  isRegisteredPrefix,
  cardIdToURL,
  IndexQueryEngine,
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
  internalKeyFor,
  visitInstanceURLs,
  maybeRelativeReference,
  codeRefFromInternalKey,
  query,
  param,
  type Expression,
} from '.';
import type { Realm } from './realm';
import type { VirtualNetwork } from './virtual-network';
import { FILE_META_RESERVED_KEYS } from './realm';
import { RealmPaths } from './paths';
import type {
  RealmResourceIdentifier,
  RealmIdentifier,
} from './card-reference-resolver';
import { rri } from './card-reference-resolver';
import {
  normalizeQueryForSignature,
  sortKeysDeep,
  type Filter,
  type Query,
} from './query';
import { CardError, type SerializedError } from './error';
import {
  isCodeRef,
  isResolvedCodeRef,
  visitModuleDeps,
  type CodeRef,
} from './code-ref';
import {
  isSingleCardDocument,
  type SingleCardDocument,
  type LinkableCollectionDocument,
  isLinkableCollectionDocument,
} from './document-types';
import { relationshipEntries } from './relationship-utils';
import type {
  CardResource,
  FileMetaResource,
  QueryFieldMeta,
  Saved,
} from './resource-types';
import { getImmediateFieldDef, type FieldDefinition } from './definitions';
import {
  normalizeQueryDefinition,
  buildQuerySearchURL,
  getValueForResourcePath,
} from './query-field-utils';

// We allow up to this many traversals into the same card type per
// `populateQueryFields` walk, matching the field-set the host emits at
// indexing time (`getFieldDefinitions` in `runtime-common/definitions.ts`
// uses the same depth for repeated card types).
const RECURSING_DEPTH = 3;

const INSTANCE_CACHE_TABLE = 'job_scoped_instance_cache';

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
  // still expand transitively. Set by the realm-server handlers when
  // the request originates inside a prerender — the caller can resolve
  // the listed IDs via per-URL fetches, and the eager closure is a
  // wasted round-trip in that context. The umbrella relationship
  // carries `links.search` only when written by `applyQueryResults`,
  // so that key is the per-field "is this query-backed?" signal at
  // follow time.
  skipQueryBackedExpansion?: boolean;
  // When true, `loadLinks` seeds the top-level result cards
  // (`populateQueryFields` on the roots) and then returns an empty array —
  // the transitive static-link BFS, the deeper-layer
  // `populateQueryFields`, and the clone-into-`included` step are all
  // skipped. (The search assembler only sets `doc.included` when the array
  // is non-empty, so the response document omits the `included` member
  // entirely.) Set by the realm-server search handlers when the request
  // originates inside a prerender: the host resolves every linked card
  // by URL via card+source (query fields from the seed umbrella, static
  // links via a `not-loaded` sentinel that lazy-loads), so the response's
  // `included[]` is dead weight. Strictly prerender-scoped — live /
  // external `_federated-search` callers still receive compound documents.
  // Implies the query-backed `${field}.N` sub-entry stripping
  // (see `skipQueryBackedExpansion`) so the seeded roots stay orphan-free.
  omitIncluded?: boolean;
  // The `<jobId>.<reservationId>` job identity (from the `x-boxel-job-id`
  // header), threaded by the realm-server search / card-GET handlers when a
  // request originates inside an indexing prerender. Enables the per-instance
  // wire-format cache (`job_scoped_instance_cache`): within one job
  // `boxel_index` is frozen, so an instance's assembled query-field
  // relationships are stable and can be reused across every search / GET that
  // touches it. The reservation is part of the key because a job can re-run
  // under a new reservation, between which committed state may move. Absent
  // for live / external callers, which therefore never read or write the
  // cache.
  jobIdentity?: string;
} & QueryOptions;

type SearchResult = SearchResultDoc | SearchResultError;

interface SearchResultDoc {
  type: 'doc';
  doc: SingleCardDocument;
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

// Stable digest key for searchCards in-flight dedup. Returns undefined if
// the inputs can't be serialized deterministically — caller falls back to
// running uncoalesced so dedup is best-effort, never a correctness boundary.
export function searchInFlightKey(
  realmURL: string,
  query: Query,
  opts: Options | undefined,
): string | undefined {
  // Encode the tuple as a JSON array (not a delimited string) so user-supplied
  // values inside query/opts — e.g. a `matches: 'a|b'` string — can never
  // collide with the delimiter and cause unrelated searches to coalesce.
  try {
    return JSON.stringify([
      realmURL,
      normalizeQueryForSignature(query),
      opts ? sortKeysDeep(opts) : null,
    ]);
  } catch {
    return undefined;
  }
}

function absolutizeInstanceURL(
  url: string,
  resourceId: string | undefined,
  setURL: (newURL: string) => void,
  virtualNetwork?: VirtualNetwork,
) {
  // Registered prefix references (e.g. @cardstack/catalog/foo) are already
  // in their canonical portable form — don't resolve them.
  if (
    virtualNetwork
      ? virtualNetwork.isRegisteredPrefix(url)
      : isRegisteredPrefix(url)
  ) {
    return;
  }
  if (!resourceId) {
    setURL(url);
    return;
  }
  setURL(
    virtualNetwork
      ? virtualNetwork.resolveURL(url, resourceId).href
      : resolveCardReference(url, resourceId),
  );
}

export class RealmIndexQueryEngine {
  #realm: Realm;
  #fetch: typeof globalThis.fetch;
  #indexQueryEngine: IndexQueryEngine;
  #definitionLookup: DefinitionLookup;
  #dbAdapter: DBAdapter;
  #log = logger('realm:index-query-engine');
  // In-flight dedup for searchCards: concurrent callers asking for the same
  // (realm, query, opts) share one in-flight promise instead of each running
  // an independent SQL + loadLinks walk.
  //
  // Safety: this layer is user-agnostic. Per-realm read authorization is
  // enforced by realm-server middleware (multiRealmAuthorization) BEFORE the
  // request reaches Realm.search → searchCards; once we're here, every
  // authorized caller for the same (realm, query, opts) is entitled to the
  // same bytes. The key intentionally omits caller identity. If per-card
  // visibility-by-user is ever added at this layer, this key must grow to
  // include the caller's identity, or the dedup must be moved up the stack
  // to where auth-equivalence is established.
  //
  // The shared resolved document is treated as read-only by all callers
  // (Realm.search → JSON.stringify → HTTP response). Do not mutate the
  // returned doc.
  #inFlightSearch = new Map<string, Promise<LinkableCollectionDocument>>();

  // Drop every pending in-flight entry. Callers that registered before the
  // drop continue to await their existing promise (the underlying SQL was
  // already in motion); only *new* callers after the drop will miss the map
  // and fire a fresh search against the now-current index. Wire this to any
  // event that means "boxel_index has just moved" — typically a worker's
  // batch.done() swap reaching this realm-server process.
  //
  // The clear is local-process only. Cross-process invalidation (peer
  // realm-server replicas serving live `_search` while a different worker
  // commits a swap) is closed by Phase 2's NOTIFY-driven eviction. Within a
  // single process — which covers dev, single-instance deployments, and the
  // realm-server-drives-its-own-indexing path — this method closes the
  // post-swap-staleness window.
  clearInFlightSearch(): void {
    this.#inFlightSearch.clear();
  }

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
    this.#indexQueryEngine = new IndexQueryEngine(dbAdapter, definitionLookup);
    this.#definitionLookup = definitionLookup;
    this.#dbAdapter = dbAdapter;
    this.#realm = realm;
    this.#fetch = fetch;
  }

  @Memoize()
  private get realmURL() {
    return new URL(this.#realm.url);
  }

  async searchCards(
    query: Query,
    opts?: Options,
  ): Promise<LinkableCollectionDocument> {
    let key = searchInFlightKey(this.#realm.url, query, opts);
    if (key !== undefined) {
      let existing = this.#inFlightSearch.get(key);
      if (existing) {
        return await existing;
      }
      let pending = this.searchCardsUncoalesced(query, opts).finally(() => {
        // Identity-check before deletion: a concurrent invalidation path
        // could in principle replace the entry. Only clean up if the map
        // still points at *this* pending promise. Mirrors
        // CachingDefinitionLookup#inFlight.
        if (this.#inFlightSearch.get(key) === pending) {
          this.#inFlightSearch.delete(key);
        }
      });
      this.#inFlightSearch.set(key, pending);
      return await pending;
    }
    return await this.searchCardsUncoalesced(query, opts);
  }

  private async searchCardsUncoalesced(
    query: Query,
    opts?: Options,
  ): Promise<LinkableCollectionDocument> {
    let doc: LinkableCollectionDocument;
    let isFileMetaQuery = await this.queryTargetsFileMeta(query.filter, opts);

    if (isFileMetaQuery) {
      let { files, meta } = await this.#indexQueryEngine.searchFiles(
        new URL(this.#realm.url),
        query,
        opts,
      );
      let resources = files.map((fileEntry) =>
        fileResourceFromIndex(new URL(fileEntry.canonicalURL), fileEntry),
      );
      if (query.fields?.['file-meta'] !== undefined) {
        resources = resources.map((r) =>
          applySparseFieldset(r, query.fields!['file-meta']),
        );
      }
      doc = {
        data: resources,
        meta,
      };
    } else {
      let { cards, meta } = await this.#indexQueryEngine.searchCards(
        new URL(this.#realm.url),
        query,
        opts,
      );
      let cardResources = cards.map((resource) => ({
        ...resource,
        ...{ links: { self: resource.id } },
      }));
      if (query.fields?.['card'] !== undefined) {
        cardResources = cardResources.map((r) =>
          applySparseFieldset(r, query.fields!['card']),
        );
      }
      doc = {
        data: cardResources,
        meta,
      };
    }

    // TODO eventually the links will be cached in the index, and this will only
    // fill in the included resources for links that were not cached (e.g.
    // volatile fields)
    if (opts?.loadLinks) {
      let linkFields = isFileMetaQuery
        ? query.fields?.['file-meta']
        : query.fields?.['card'];
      let linkOpts = linkFields ? { ...opts, linkFields } : opts;
      let omit = doc.data.map((r) => r.id).filter(Boolean) as string[];
      // Process all root resources together so a single batched DB query
      // resolves their first-level links (1+1 instead of N+M sequential
      // round-trips). See CS-11038.
      let included = await this.loadLinks(
        {
          realmURL: this.realmURL,
          rootResources: doc.data,
          omit,
        },
        linkOpts,
      );
      if (included.length > 0) {
        doc.included = included;
      }
    }
    await this.attachRealmInfo(doc);
    return doc;
  }

  private async queryTargetsFileMeta(
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

  // When a relationship in the pristine_doc is missing data.type (stale
  // index data from before the fix that added data to NotLoadedValue
  // serialization), we need to consult the field definition to determine
  // whether the relationship targets a FileDef or a CardDef.
  private async fieldExpectsFileMeta(
    resource: LooseCardResource | FileMetaResource,
    fieldKey: string,
    opts?: Options,
  ): Promise<boolean> {
    if (!resource.meta?.adoptsFrom) {
      return false;
    }
    let relativeTo = resource.id
      ? this.#realm.virtualNetwork.toURL(resource.id)
      : this.realmURL;
    let codeRef = codeRefWithAbsoluteIdentifier(
      resource.meta.adoptsFrom,
      relativeTo,
      undefined,
      this.#realm.virtualNetwork,
    );
    if (!isResolvedCodeRef(codeRef)) {
      return false;
    }
    try {
      let definition: import('./definitions').Definition | undefined;
      if (opts?.cacheOnlyDefinitions) {
        definition =
          await this.#definitionLookup.lookupCachedDefinition(codeRef);
        if (!definition) {
          return false;
        }
      } else {
        definition = await this.#definitionLookup.lookupDefinition(codeRef, {
          ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
        });
      }
      if (!definition) {
        return false;
      }
      // Strip the linksToMany index suffix (e.g., "friends.0" -> "friends")
      let fieldName = fieldKey.includes('.')
        ? fieldKey.slice(0, fieldKey.indexOf('.'))
        : fieldKey;
      let fieldDefinition = getImmediateFieldDef(definition, fieldName);
      if (!fieldDefinition) {
        return false;
      }
      let fieldCardRef = fieldDefinition.fieldOrCard;
      let isFileType = await this.#indexQueryEngine.hasFileType(
        this.realmURL,
        fieldCardRef,
        opts,
      );
      let isInstanceType = await this.#indexQueryEngine.hasInstanceType(
        this.realmURL,
        fieldCardRef,
        opts,
      );
      return isFileType && !isInstanceType;
    } catch {
      return false;
    }
  }

  async fetchCardTypeSummary() {
    let results = await this.#indexQueryEngine.fetchCardTypeSummary(
      new URL(this.#realm.url),
    );

    return results;
  }

  async searchPrerendered(query: Query, opts?: Options) {
    let isFileMetaQuery = await this.queryTargetsFileMeta(query.filter, opts);
    if (isFileMetaQuery) {
      // File-meta prerendered search currently returns non-error rows.
      let { includeErrors: _includeErrors, ...fileSearchOpts } = opts ?? {};
      let { files, meta } = await this.#indexQueryEngine.searchFiles(
        new URL(this.#realm.url),
        query,
        fileSearchOpts,
      );

      let scopedCssUrls = new Set<string>();
      let prerenderedCards = files.map((file) => {
        (file.deps ?? []).forEach((dep) => {
          if (isScopedCSSRequest(dep)) {
            scopedCssUrls.add(dep);
          }
        });
        return this.fileEntryToPrerenderedCard(file, opts);
      });

      return {
        prerenderedCards,
        scopedCssUrls: [...scopedCssUrls],
        meta: { ...meta, isFileMeta: true as const },
      };
    }
    return await this.#indexQueryEngine.searchPrerendered(
      new URL(this.#realm.url),
      query,
      opts,
    );
  }

  private fileEntryToPrerenderedCard(file: IndexedFile, opts?: Options) {
    let html: string | null = null;
    let usedRenderTypeKey: string | undefined;
    switch (opts?.htmlFormat) {
      case 'head':
        html = file.headHtml;
        break;
      case 'embedded':
      case 'fitted': {
        let htmlByType =
          opts.htmlFormat === 'embedded' ? file.embeddedHtml : file.fittedHtml;
        if (htmlByType) {
          if (opts.renderType) {
            let renderTypeKey = internalKeyFor(
              opts.renderType,
              undefined,
              this.#realm.virtualNetwork,
            );
            if (htmlByType[renderTypeKey] != null) {
              html = htmlByType[renderTypeKey];
              usedRenderTypeKey = renderTypeKey;
            }
          }
          if (html == null) {
            let defaultTypeKey = file.types?.[0];
            if (defaultTypeKey && htmlByType[defaultTypeKey] != null) {
              html = htmlByType[defaultTypeKey];
              usedRenderTypeKey = defaultTypeKey;
            }
          }
        }
        break;
      }
      case 'atom':
      default:
        html = file.atomHtml;
    }

    if (!usedRenderTypeKey) {
      usedRenderTypeKey = file.types?.[0];
    }

    let usedRenderType: ResolvedCodeRef | undefined;
    if (usedRenderTypeKey) {
      let codeRef = codeRefFromInternalKey(usedRenderTypeKey);
      if (isResolvedCodeRef(codeRef)) {
        usedRenderType = codeRef;
      }
    }

    return {
      url: file.canonicalURL,
      html,
      ...(file.displayNames?.[0] ? { cardType: file.displayNames[0] } : {}),
      ...(file.iconHtml ? { iconHtml: file.iconHtml } : {}),
      ...(usedRenderType ? { usedRenderType } : {}),
    };
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

  async loadLinksForResource(
    resource: LooseCardResource | FileMetaResource,
    opts?: Options,
  ): Promise<(CardResource<Saved> | FileMetaResource)[]> {
    return await this.loadLinks(
      {
        realmURL: this.realmURL,
        rootResources: [resource],
        omit: [...(resource.id ? [resource.id] : [])],
      },
      opts,
    );
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
    definition: import('./definitions').Definition,
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
    codeRef: import('./code-ref').ResolvedCodeRef,
    opts: Options | undefined,
  ): Promise<import('./definitions').Definition | undefined> {
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
    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition,
      resource,
      realmURL,
      fieldName,
      fieldPath,
      resolvePathValue: (path) => getValueForResourcePath(resource, path),
      relativeTo: resource.id
        ? this.#realm.virtualNetwork.toURL(resource.id)
        : realmURL,
      virtualNetwork: this.#realm.virtualNetwork,
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
      let response = await this.#fetch(searchURL, {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
        },
        body: JSON.stringify({ ...queryWithoutRealm, realms: realmList }),
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
      if (!isLinkableCollectionDocument(json)) {
        return {
          cards: [],
          error: {
            realm: realmHref,
            type: 'unknown',
            message: 'remote realm returned unexpected payload',
          },
        };
      }
      return { cards: json.data };
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
    doc: SingleCardDocument | LinkableCollectionDocument,
  ): Promise<void> {
    let realmInfo = await this.#realm.getRealmInfo();
    let resources = Array.isArray(doc.data) ? doc.data : [doc.data];
    for (let resource of [...resources, ...(doc.included ?? [])]) {
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
  ): Promise<Map<string, CardResource<Saved>>> {
    let entries = await Promise.all(
      urls.map(async (url) => {
        let response: Response;
        try {
          response = await this.#fetch(url, {
            headers: { Accept: SupportedMimeType.CardJson },
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
        // Gate on Content-Type before parsing. A relationship's
        // `links.self` can point at a non-card URL (a raw image, a PDF);
        // the server then returns binary, and handing those bytes to
        // `response.json()` yields an opaque parse error whose message
        // embeds the raw bytes. Fail fast with a structured, human-
        // readable error that names the offending field, URL, and the
        // actual content type — the common case being an author who
        // confused an image-URL field with a card relationship.
        let contentType = response.headers.get('content-type');
        if (!isJsonContentType(contentType)) {
          let fieldName = linkContext?.get(url)?.fieldName;
          let fieldLabel = fieldName
            ? `Relationship \`${fieldName}\``
            : 'A relationship';
          throw new Error(
            `${fieldLabel} links to a non-card URL (${
              contentType ?? 'unknown content type'
            }): ${url}. The link should resolve to a card document; it likely points at a binary resource (e.g. an image) instead.`,
          );
        }
        let json = await response.json();
        if (!isSingleCardDocument(json)) {
          throw new Error(
            `instance ${url} is not a card document. it is: ${JSON.stringify(
              json,
              null,
              2,
            )}`,
          );
        }
        let linkResource: CardResource<Saved> = {
          ...json.data,
          ...{ links: { self: json.data.id } },
        };
        return [url, linkResource] as const;
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
  // ── Job-scoped per-instance wire-format cache (job_scoped_instance_cache) ──
  // Within one indexing job `boxel_index` is frozen, so an instance's assembled
  // query-field relationships are stable. Caching them per (jobIdentity, url)
  // lets every later occurrence of the instance in the job — another search
  // result, a per-URL card GET, a linked target — skip the definition lookup +
  // field-tree walk that `populateQueryFields` would otherwise repeat.

  // Cache coordinates for a resource, or undefined when caching doesn't apply:
  // no job identity, no id, or a sparse-fieldset (partial) population that
  // mustn't masquerade as a full assembly. `jobIdentity` is derived from the
  // sanitized `x-boxel-job-id` header, which by design only indexer-driven
  // prerender requests carry — so in normal operation this scopes the cache to
  // indexing and live / external traffic skips it (it is an expectation about
  // callers, not a property this layer enforces).
  #instanceCacheKey(
    resource: LooseCardResource | FileMetaResource,
    opts: Options | undefined,
  ): { jobId: string; url: string } | undefined {
    if (!opts?.jobIdentity || !resource.id || opts.linkFields) {
      return undefined;
    }
    return { jobId: opts.jobIdentity, url: resource.id };
  }

  // `undefined` = cache miss (no row); `null` = cached "no relationships";
  // object = cached relationships map. Best-effort: a read failure degrades to
  // a recompute, never an error.
  async #readCachedRelationships(
    jobId: string,
    url: string,
  ): Promise<Record<string, unknown> | null | undefined> {
    try {
      let rows = (await query(this.#dbAdapter, [
        `SELECT result FROM ${INSTANCE_CACHE_TABLE} WHERE job_id =`,
        param(jobId),
        ` AND url =`,
        param(url),
      ] as Expression)) as { result: string }[];
      if (!rows.length) {
        return undefined;
      }
      return JSON.parse(rows[0].result) as Record<string, unknown> | null;
    } catch (err: unknown) {
      this.#log.warn(
        `per-instance cache read failed for ${url} (job ${jobId}): ${String(err)}`,
      );
      return undefined;
    }
  }

  // First write wins (ON CONFLICT DO NOTHING) — concurrent populates of the
  // same instance in one job produce equivalent results against the frozen
  // index, so either is valid. Best-effort: a write failure is logged, never
  // thrown.
  async #writeCachedRelationships(
    jobId: string,
    url: string,
    relationships: unknown,
  ): Promise<void> {
    try {
      await query(this.#dbAdapter, [
        `INSERT INTO ${INSTANCE_CACHE_TABLE} (job_id, url, result) VALUES (`,
        param(jobId),
        `,`,
        param(url),
        `,`,
        param(JSON.stringify(relationships ?? null)),
        `) ON CONFLICT (job_id, url) DO NOTHING`,
      ] as Expression);
    } catch (err: unknown) {
      this.#log.warn(
        `per-instance cache write failed for ${url} (job ${jobId}): ${String(err)}`,
      );
    }
  }

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
    let realmPath = new RealmPaths(realmURL, this.#realm.virtualNetwork);
    let omitSet = new Set(omit);
    let visited = new Set<string>();

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
        visited.add(resource.id);
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
      let currentLayerIndex = layerIndex++;
      // Step 1: run populateQueryFields for every resource in this layer in
      // parallel. Each runs an independent searchCards query for its
      // computed query-fields; collapsing those across the layer is a
      // separate optimization (out of scope for CS-11038).
      try {
        await Promise.all(
          layer.map(async ({ resource, applyLinkFields }) => {
            let popOpts = applyLinkFields
              ? opts
              : opts?.linkFields
                ? { ...opts, linkFields: undefined }
                : opts;
            let cacheKey = this.#instanceCacheKey(resource, popOpts);
            if (cacheKey) {
              let cached = await this.#readCachedRelationships(
                cacheKey.jobId,
                cacheKey.url,
              );
              if (cached !== undefined) {
                // Hit: reuse this instance's assembled query-field
                // relationships from an earlier occurrence in the same job,
                // skipping the definition lookup + field-tree walk. The
                // cached value is pre-strip; the `${field}.N` /
                // included-omission steps below run uniformly on hit and miss.
                if (cached === null) {
                  delete (resource as { relationships?: unknown })
                    .relationships;
                } else {
                  (resource as { relationships?: unknown }).relationships =
                    cached;
                }
                return;
              }
            }
            let storedDefs = (
              resource.meta as {
                queryFieldDefs?: Record<string, QueryFieldMeta>;
              }
            )?.queryFieldDefs;
            if (popOpts?.cacheOnlyDefinitions && storedDefs) {
              await this.populateQueryFieldsFromMeta(
                resource,
                realmURL,
                storedDefs,
                popOpts,
              );
            } else {
              await this.populateQueryFields(resource, realmURL, popOpts);
            }
            if (cacheKey) {
              await this.#writeCachedRelationships(
                cacheKey.jobId,
                cacheKey.url,
                (resource as { relationships?: unknown }).relationships,
              );
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
      // so leaving them on the wire alongside an omitted / query-backed
      // `included[]` produces orphan-link errors. The umbrella entry
      // (`fieldName`) stays — it carries `links.search` and
      // `data: [array of IDs]` for the host's per-URL hydration path.
      // Runs for both the query-backed-only prerender skip and the
      // broader `omitIncluded` short-circuit below.
      if (opts?.skipQueryBackedExpansion || opts?.omitIncluded) {
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

      // Prerender included-omission: the host never reads the search
      // response's `included[]` — it resolves every linked card by URL
      // via card+source (query fields from the seed umbrella written by
      // `populateQueryFields` above; static links via a `not-loaded`
      // sentinel that lazy-loads). Once the root result cards are seeded,
      // the transitive static-link BFS (Steps 2-5) and the deeper-layer
      // `populateQueryFields` are pure waste, so stop after the root
      // layer and return an empty array (the caller then omits the
      // `included` member from the response document). Strictly
      // prerender-scoped.
      if (opts?.omitIncluded) {
        break;
      }

      // Step 2: walk every resource's relationships, classify each link,
      // and accumulate URL sets for the batched DB queries.
      type Entry = {
        item: LayerItem;
        relationship: import('./resource-types').Relationship;
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
      // Remember which relationship field produced each cross-realm URL
      // so a link that fails to resolve to a card can name the offending
      // field in its error message.
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

          let relationshipType = relationship.data?.type as
            | typeof CardResourceType
            | typeof FileMetaResourceType
            | undefined;
          let expectsFileMeta = relationshipType === FileMetaResourceType;
          let expectsCard = relationshipType === CardResourceType;
          // Stale index payloads can incorrectly record file relationships
          // as type "card" (or omit type entirely) when linked files were
          // indexed after instances. Trust the field declaration in that
          // case.
          if (
            !expectsFileMeta &&
            (relationshipType === CardResourceType || !relationshipType)
          ) {
            expectsFileMeta = await this.fieldExpectsFileMeta(
              resource,
              key,
              activeOpts,
            );
            if (expectsFileMeta) {
              expectsCard = false;
            }
          }

          let vn = this.#realm.virtualNetwork;
          let linkURL = vn.resolveURL(
            relationship.links.self,
            resource.id ? vn.toURL(resource.id) : realmURL,
          );
          let resolvedSelf: string;
          try {
            resolvedSelf = vn.resolveURL(
              relationship.links.self,
              resource.id,
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
      let crossRealmMap: Map<string, CardResource<Saved>>;
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
            : Promise.resolve(new Map<string, CardResource<Saved>>()),
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
          included.find((i) => i.id === entry.relationshipIdStr)
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
        if (included.find((r) => r.id === resource.id)) {
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
  virtualNetwork?: VirtualNetwork,
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

function relativizeResource(
  resource: LooseCardResource,
  primaryURL: URL,
  realmURL: URL,
  virtualNetwork?: VirtualNetwork,
) {
  // resource.id may be a registered prefix (e.g. @cardstack/openrouter/...)
  // which is not a valid URL base. Resolve it to a URL for relative resolution.
  let resourceURL = resource.id
    ? virtualNetwork
      ? virtualNetwork.toURL(resource.id)
      : cardIdToURL(resource.id)
    : primaryURL;
  visitInstanceURLs(resource, (url, setURL) => {
    // Registered prefix references (e.g. @cardstack/catalog/foo) are already
    // in their canonical portable form — don't resolve or relativize them.
    if (
      virtualNetwork
        ? virtualNetwork.isRegisteredPrefix(url)
        : isRegisteredPrefix(url)
    ) {
      return;
    }
    let urlObj = virtualNetwork
      ? virtualNetwork.resolveURL(url, resourceURL)
      : new URL(resolveCardReference(url, resourceURL));
    setURL(maybeRelativeReference(urlObj, primaryURL, realmURL));
  });
  visitModuleDeps(resource, (moduleURL, setModuleURL) => {
    // Registered prefix references (e.g. @cardstack/catalog/foo) are already
    // in their canonical portable form — don't resolve or relativize them.
    if (
      virtualNetwork
        ? virtualNetwork.isRegisteredPrefix(moduleURL)
        : isRegisteredPrefix(moduleURL)
    ) {
      return;
    }
    let absoluteModuleURL = virtualNetwork
      ? virtualNetwork.resolveURL(moduleURL, resourceURL)
      : new URL(resolveCardReference(moduleURL, resourceURL));
    setModuleURL(
      maybeRelativeReference(
        absoluteModuleURL,
        primaryURL,
        realmURL,
      ) as RealmResourceIdentifier,
    );
  });
}

function applySparseFieldset<T extends CardResource<Saved> | FileMetaResource>(
  resource: T,
  fields: string[],
): T {
  // Per JSON:API spec, id, type, links, meta are always preserved.
  // Only filter attributes.
  if (fields.length === 0) {
    return { ...resource, attributes: {} };
  }
  let filtered: Record<string, any> = {};
  for (let field of fields) {
    if (resource.attributes?.[field] !== undefined) {
      filtered[field] = resource.attributes[field];
    }
  }
  return { ...resource, attributes: filtered };
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
          module: `${baseRealm.url}card-api`,
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
