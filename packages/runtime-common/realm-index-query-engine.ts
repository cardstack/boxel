import { isScopedCSSRequest } from './scoped-css.ts';
import cloneDeep from 'lodash/cloneDeep';
import {
  SupportedMimeType,
  isJsonContentType,
  baseRealm,
  inferContentType,
  unixTime,
  maxLinkDepth,
  maybeURL,
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
} from '.';
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
import {
  normalizeQueryForSignature,
  sortKeysDeep,
  type Filter,
  type Query,
} from './query.ts';
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
  type LinkableCollectionDocument,
  type UnifiedSearchCollectionDocument,
  type UnifiedSearchIncludedResource,
  isLinkableCollectionDocument,
} from './document-types.ts';
import { relationshipEntries } from './relationship-utils.ts';
import type {
  CardResource,
  CssResource,
  FileMetaResource,
  QueryFieldMeta,
  Saved,
} from './resource-types.ts';
import type { PrerenderedHtmlFormat } from './prerendered-html-format.ts';
import {
  buildCssResource,
  buildIdentityOnlyCard,
  buildRenderedHtmlResource,
  parseUsedRenderType,
  scopedCssHrefsFromDeps,
} from './unified-search.ts';
import { getImmediateFieldDef, type FieldDefinition } from './definitions.ts';
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
    // `timings` is a per-request diagnostic collector, not part of the
    // result-shaping opts. Exclude it from the key so it can't perturb the
    // in-flight coalescing — two otherwise-identical searches must still
    // dedupe even though each carries its own collector.
    let keyOpts = opts;
    if (opts && 'timings' in opts) {
      let { timings: _omitTimings, ...rest } = opts;
      keyOpts = rest;
    }
    return JSON.stringify([
      realmURL,
      normalizeQueryForSignature(query),
      keyOpts ? sortKeysDeep(keyOpts) : null,
    ]);
  } catch {
    return undefined;
  }
}

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

  async searchCards(
    query: Query,
    opts?: Options,
  ): Promise<LinkableCollectionDocument> {
    let key = searchInFlightKey(this.#realm.url, query, opts);
    if (key !== undefined) {
      let existing = this.#inFlightSearch.get(key);
      if (existing) {
        // A concurrent identical search is already running; this follower
        // awaits its result instead of re-running the work. Record that wait
        // as `coalescedWait` on the follower's own collector so its
        // `realm:search-timing` line reflects the time spent — otherwise the
        // follower would show no `sql`/`loadLinks` and look misleadingly
        // instant exactly under the concurrent search load we're diagnosing.
        return opts?.timings
          ? await opts.timings.time('coalescedWait', () => existing)
          : await existing;
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
      let runCardSql = () =>
        this.#indexQueryEngine.searchCards(
          new URL(this.#realm.url),
          query,
          opts,
        );
      let { cards, meta } = opts?.timings
        ? await opts.timings.time('sql', runCardSql)
        : await runCardSql();
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
    //
    // Prerender searches (`omitIncluded`) skip the relationship-assembly pass
    // entirely: the host re-resolves every result card from its raw
    // card+source file and consumes only `data[].id`, so `loadLinks` /
    // `populateQueryFields` — the query-field umbrellas and the transitive
    // `included[]` expansion — is provably throwaway work here. The response
    // carries the pristine result rows (ids + attributes + static-link
    // relationships) and page meta only. Live / external callers still run
    // the full pass below.
    if (opts?.loadLinks && !opts?.omitIncluded) {
      let linkFields = isFileMetaQuery
        ? query.fields?.['file-meta']
        : query.fields?.['card'];
      let linkOpts = linkFields ? { ...opts, linkFields } : opts;
      let omit = doc.data.map((r) => r.id).filter(Boolean) as string[];
      // Process all root resources together so a single batched DB query
      // resolves their first-level links (1+1 instead of N+M sequential
      // round-trips). See CS-11038.
      let runLoadLinks = () =>
        this.loadLinks(
          {
            realmURL: this.realmURL,
            rootResources: doc.data,
            omit,
          },
          linkOpts,
        );
      let included = opts?.timings
        ? await opts.timings.time('loadLinks', runLoadLinks)
        : await runLoadLinks();
      if (included.length > 0) {
        doc.included = included;
      }
    }
    await this.attachRealmInfo(doc);
    return doc;
  }

  // Prefer-HTML unified search. Runs the single `render` projection and applies
  // the per-row resolution policy:
  //   - a row WITH html → an identity-only `card` (no live serialization) plus
  //     a `rendered-html` (+ its `css`) in `included`;
  //   - a row WITHOUT html → the full live `card` from its pristine row,
  //     exactly as the data-only path returns it.
  // Only the no-HTML fallback cards go through `loadLinks` — an identity-only
  // card has no relationships to expand. `css` resources dedupe by their
  // content-hash id across rows. A query that targets file-meta has no HTML
  // projection, so it resolves to the full live file-meta document.
  async searchUnified(
    query: Query,
    opts: Options & {
      render: { format: PrerenderedHtmlFormat; renderType?: CodeRef };
    },
  ): Promise<UnifiedSearchCollectionDocument> {
    if (await this.queryTargetsFileMeta(query.filter, opts)) {
      return await this.searchCardsUncoalesced(query, opts);
    }

    // `includeErrors` so error rows reach the mapper as `rendered-html` with
    // `isError` (the data-only path excludes them, matching the live `/_search`).
    let runSql = () =>
      this.#indexQueryEngine.search(
        new URL(this.#realm.url),
        query,
        { ...opts, includeErrors: true },
        {
          kind: 'render',
          htmlFormat: opts.render.format,
          // `internalKeyFor` (used by the HTML-column expression) resolves a
          // relative module, so a plain `CodeRef` is accepted here; a render type
          // is always a concrete `{module,name}`, never an ancestorOf/fieldOf ref.
          renderType: opts.render.renderType as ResolvedCodeRef | undefined,
        },
      );
    let { results, meta } = opts?.timings
      ? await opts.timings.time('sql', runSql)
      : await runSql();

    let data: (CardResource<Saved> | FileMetaResource)[] = [];
    let renderedResources: UnifiedSearchIncludedResource[] = [];
    let cssById = new Map<string, CssResource>();
    let fallbackRoots: (CardResource<Saved> | FileMetaResource)[] = [];

    for (let row of results) {
      let fileUrl = row.url;
      if (!fileUrl) {
        continue;
      }
      // The index `url` column is the instance's file URL; a card's identity
      // (the live card's `id`, shared with its `rendered-html`) drops the
      // `.json` extension. Fallback rows take their id from `pristine_doc`,
      // which already carries the identity form.
      let cardUrl = fileUrl.endsWith('.json') ? fileUrl.slice(0, -5) : fileUrl;
      let hasError = Boolean(row.has_error);
      let html = (row.html as string | null) ?? null;

      if (html != null || hasError) {
        // HTML-backed (or error) row: rendered-html + identity-only card.
        let cssIds: string[] = [];
        for (let href of scopedCssHrefsFromDeps(row.deps as string[] | null)) {
          let css = buildCssResource(href);
          if (!cssById.has(css.id)) {
            cssById.set(css.id, css);
          }
          cssIds.push(css.id);
        }
        let renderType = parseUsedRenderType(
          row.used_render_type as string | null,
        );
        // The actual (most-derived) type rides in `types[0]`; the type the HTML
        // was rendered as is `renderType` — they differ when an ancestor type
        // was requested. The identity-only card's `adoptsFrom` is the actual
        // type.
        let adoptsFrom =
          parseUsedRenderType((row.types as string[] | null)?.[0]) ??
          renderType;
        let cardType = (row.display_names as string[] | null)?.[0] ?? '';
        renderedResources.push(
          buildRenderedHtmlResource({
            url: cardUrl,
            html: html ?? '',
            cardType,
            iconHtml: (row.icon_html as string | null) ?? undefined,
            isError: hasError || undefined,
            renderType,
            cssIds,
          }),
        );
        if (adoptsFrom) {
          data.push(
            buildIdentityOnlyCard({ url: cardUrl, adoptsFrom, renderType }),
          );
        }
      } else {
        // No HTML: fall back to the full live card, exactly as `/_search` —
        // honoring any sparse fieldset the query requested, so a fallback row
        // carries the same attributes/relationships the data-only path would.
        let pristine = row.pristine_doc as CardResource<Saved> | null;
        if (pristine) {
          let card: CardResource<Saved> = {
            ...pristine,
            links: { self: pristine.id },
          };
          if (query.fields?.['card'] !== undefined) {
            card = applySparseFieldset(card, query.fields['card']);
          }
          data.push(card);
          fallbackRoots.push(card);
        }
      }
    }

    // first-seen render-html order, then deduped css.
    let included: UnifiedSearchIncludedResource[] = [
      ...renderedResources,
      ...cssById.values(),
    ];

    // Assemble the transitive `included` for the live fallback cards only.
    // Same gating as the data-only path: skipped inside a prerender, where the
    // host re-resolves each result from its card+source file. The query's
    // `fields.card` (when present) scopes the link expansion, matching
    // `/_search`.
    if (fallbackRoots.length > 0 && opts?.loadLinks && !opts?.omitIncluded) {
      let linkFields = query.fields?.['card'];
      let linkOpts = linkFields ? { ...opts, linkFields } : opts;
      let omit = data.map((r) => r.id).filter(Boolean) as string[];
      let runLoadLinks = () =>
        this.loadLinks(
          { realmURL: this.realmURL, rootResources: fallbackRoots, omit },
          linkOpts,
        );
      let fallbackIncluded = opts?.timings
        ? await opts.timings.time('loadLinks', runLoadLinks)
        : await runLoadLinks();
      included.push(...fallbackIncluded);
    }

    let doc: UnifiedSearchCollectionDocument = { data, meta };
    if (included.length > 0) {
      doc.included = included;
    }
    // Echo the collection-level render type when it's a single resolved type
    // (an explicit `renderType`); the `"native"` / per-row cases vary by row
    // and are echoed on each `rendered-html` instead.
    if (opts.render.renderType) {
      doc.meta.renderType = opts.render.renderType;
    }
    await this.attachRealmInfo(doc as unknown as LinkableCollectionDocument);
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
      let definition: import('./definitions.ts').Definition | undefined;
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
  ): Promise<Map<string, CardResource<Saved> | FileMetaResource>> {
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
    // Registered prefix references (e.g. @cardstack/catalog/foo) are already
    // in their canonical portable form — don't resolve or relativize them.
    if (virtualNetwork.isRegisteredPrefix(url)) {
      return;
    }
    let urlObj = virtualNetwork.resolveURL(url, resourceURL);
    setURL(maybeRelativeReference(urlObj, primaryURL, realmURL));
  });
  visitModuleDeps(resource, (moduleURL, setModuleURL) => {
    // Registered prefix references (e.g. @cardstack/catalog/foo) are already
    // in their canonical portable form — don't resolve or relativize them.
    if (virtualNetwork.isRegisteredPrefix(moduleURL)) {
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
