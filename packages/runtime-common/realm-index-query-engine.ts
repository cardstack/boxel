import { Memoize } from 'typescript-memoize';
import { isScopedCSSRequest } from 'glimmer-scoped-css';
import cloneDeep from 'lodash/cloneDeep';
import {
  SupportedMimeType,
  baseRealm,
  inferContentType,
  unixTime,
  maxLinkDepth,
  maybeURL,
  IndexQueryEngine,
  codeRefWithAbsoluteURL,
  logger,
  CardResourceType,
  FileMetaResourceType,
  type LooseCardResource,
  type DBAdapter,
  type QueryOptions,
  type IndexedModuleOrError,
  type InstanceOrError,
  type IndexedFile,
  type DefinitionLookup,
  visitInstanceURLs,
  maybeRelativeURL,
  codeRefFromInternalKey,
} from '.';
import type { Realm } from './realm';
import { FILE_META_RESERVED_KEYS } from './realm';
import { RealmPaths } from './paths';
import type { Filter, Query } from './query';
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
import type { CardResource, FileMetaResource, Saved } from './resource-types';
import type { FieldDefinition } from './definitions';
import {
  normalizeQueryDefinition,
  buildQuerySearchURL,
  getValueForResourcePath,
} from './query-field-utils';

type Options = {
  loadLinks?: true;
} & QueryOptions;

type SearchResult = SearchResultDoc | SearchResultError;

interface SearchResultDoc {
  type: 'doc';
  doc: SingleCardDocument;
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
) {
  if (!resourceId) {
    setURL(url);
    return;
  }
  setURL(new URL(url, resourceId).href);
}

export class RealmIndexQueryEngine {
  #realm: Realm;
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
    this.#indexQueryEngine = new IndexQueryEngine(dbAdapter, definitionLookup);
    this.#definitionLookup = definitionLookup;
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
    let doc: LinkableCollectionDocument;

    if (await this.queryTargetsFileMeta(query.filter, opts)) {
      let { files, meta } = await this.#indexQueryEngine.searchFiles(
        new URL(this.#realm.url),
        query,
        opts,
      );
      doc = {
        data: files.map((fileEntry) =>
          fileResourceFromIndex(new URL(fileEntry.canonicalURL), fileEntry),
        ),
        meta,
      };
    } else {
      let { cards, meta } = await this.#indexQueryEngine.searchCards(
        new URL(this.#realm.url),
        query,
        opts,
      );
      doc = {
        data: cards.map((resource) => ({
          ...resource,
          ...{ links: { self: resource.id } },
        })),
        meta,
      };
    }

    // TODO eventually the links will be cached in the index, and this will only
    // fill in the included resources for links that were not cached (e.g.
    // volatile fields)
    if (opts?.loadLinks) {
      let omit = doc.data.map((r) => r.id).filter(Boolean) as string[];
      let included: (CardResource<Saved> | FileMetaResource)[] = [];
      for (let resource of doc.data) {
        included = await this.loadLinks(
          {
            realmURL: this.realmURL,
            resource,
            omit,
            included,
          },
          opts,
        );
      }
      if (included.length > 0) {
        doc.included = included;
      }
    }
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
    let relativeTo = resource.id ? new URL(resource.id) : this.realmURL;
    let codeRef = codeRefWithAbsoluteURL(resource.meta.adoptsFrom, relativeTo);
    if (!isResolvedCodeRef(codeRef)) {
      return false;
    }
    try {
      let definition = await this.#definitionLookup.lookupDefinition(codeRef);
      // Strip the linksToMany index suffix (e.g., "friends.0" -> "friends")
      let fieldName = fieldKey.includes('.')
        ? fieldKey.slice(0, fieldKey.indexOf('.'))
        : fieldKey;
      let fieldDefinition = definition.fields[fieldName];
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
    let results = await this.#indexQueryEngine.searchPrerendered(
      new URL(this.#realm.url),
      query,
      opts,
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
          resource: doc.data,
          omit: [...(doc.data.id ? [doc.data.id] : [])],
        },
        opts,
      );
      if (included.length > 0) {
        doc.included = included;
      }
    }
    relativizeDocument(doc, this.realmURL);
    return { type: 'doc', doc };
  }

  async module(
    url: URL,
    opts?: Options,
  ): Promise<IndexedModuleOrError | undefined> {
    return await this.#indexQueryEngine.getModule(url, opts);
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

    let relativeTo = resource.id ? new URL(resource.id) : realmURL;
    let codeRef = codeRefWithAbsoluteURL(resource.meta.adoptsFrom, relativeTo);
    if (!isResolvedCodeRef(codeRef)) {
      return;
    }
    let definition = await this.#definitionLookup.lookupDefinition(codeRef);
    for (let [fieldName, fieldDefinition] of Object.entries(
      definition.fields,
    )) {
      let queryDefinition = this.getQueryDefinition(fieldDefinition);

      if (
        (fieldDefinition.type !== 'linksTo' &&
          fieldDefinition.type !== 'linksToMany') ||
        !queryDefinition
      ) {
        continue;
      }

      let { results, errors, searchURL } = await this.executeQueryForField({
        fieldDefinition,
        fieldName,
        queryDefinition,
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
      relativeTo: resource.id ? new URL(resource.id) : realmURL,
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

  // TODO The caller should provide a list of fields to be included via JSONAPI
  // request. currently we just use the maxLinkDepth to control how deep to load
  // links
  private async loadLinks(
    {
      realmURL,
      resource,
      omit = [],
      included = [],
      visited = [],
      stack = [],
    }: {
      realmURL: URL;
      resource: LooseCardResource | FileMetaResource;
      omit?: string[];
      included?: (CardResource<Saved> | FileMetaResource)[];
      visited?: string[];
      stack?: string[];
    },
    opts?: Options,
  ): Promise<(CardResource<Saved> | FileMetaResource)[]> {
    if (resource.id != null) {
      if (visited.includes(resource.id)) {
        return [];
      }
      visited.push(resource.id);
    }
    let realmPath = new RealmPaths(realmURL);
    let processedRelationships = new Set<string>();
    let processRelationships = async () => {
      for (let entry of relationshipEntries(resource.relationships)) {
        let { relationship, key } = entry;
        if (processedRelationships.has(key)) {
          continue;
        }
        if (!relationship.links?.self) {
          continue;
        }
        if (Array.isArray(relationship.data)) {
          throw new Error(
            `bug: relationship ${key} cannot be a list when loading links`,
          );
        }
        let relationshipType = relationship.data?.type;
        let expectsFileMeta = relationshipType === FileMetaResourceType;
        let expectsCard = relationshipType === CardResourceType;
        processedRelationships.add(key);
        let linkURL = new URL(
          relationship.links.self,
          resource.id ? new URL(resource.id) : realmURL,
        );
        let linkResource: CardResource<Saved> | FileMetaResource | undefined;
        if (realmPath.inRealm(linkURL)) {
          if (expectsCard || !relationshipType) {
            let maybeResult = await this.#indexQueryEngine.getInstance(
              linkURL,
              opts,
            );
            if (maybeResult?.type === 'instance') {
              linkResource = maybeResult.instance;
            }
          }
          if (!linkResource) {
            // Determine whether to try the file index:
            // - If data.type explicitly says file-meta, try it
            // - If data.type is missing (stale index data), consult the
            //   field definition to avoid incorrectly degrading a CardDef
            //   relationship to file-meta
            let shouldTryFile = expectsFileMeta;
            if (!shouldTryFile && !relationshipType) {
              shouldTryFile = await this.fieldExpectsFileMeta(
                resource,
                key,
                opts,
              );
            }
            if (shouldTryFile) {
              let fileEntry = await this.#indexQueryEngine.getFile(
                linkURL,
                opts,
              );
              if (fileEntry) {
                linkResource = fileResourceFromIndex(linkURL, fileEntry);
              }
            }
          }
        } else {
          let response = await this.#fetch(linkURL, {
            headers: { Accept: SupportedMimeType.CardJson },
          });
          if (!response.ok) {
            let cardError = await CardError.fromFetchResponse(
              linkURL.href,
              response,
            );
            throw cardError;
          }
          let json = await response.json();
          if (!isSingleCardDocument(json)) {
            throw new Error(
              `instance ${
                linkURL.href
              } is not a card document. it is: ${JSON.stringify(
                json,
                null,
                2,
              )}`,
            );
          }
          linkResource = {
            ...json.data,
            ...{ links: { self: json.data.id } },
          };
        }
        let foundLinks = false;
        // TODO stop using maxLinkDepth. we should save the JSON-API doc in the
        // index based on keeping track of the rendered fields and invalidate the
        // index as consumed cards change
        if (linkResource && stack.length <= maxLinkDepth) {
          for (let includedResource of await this.loadLinks(
            {
              realmURL,
              resource: linkResource,
              omit,
              included: [...included, linkResource],
              visited,
              stack: [...(resource.id != null ? [resource.id] : []), ...stack],
            },
            opts,
          )) {
            foundLinks = true;
            if (
              includedResource.id &&
              !omit.includes(includedResource.id) &&
              !included.find((r) => r.id === includedResource.id)
            ) {
              let rewrittenResource = cloneDeep({
                ...includedResource,
                ...{ links: { self: includedResource.id } },
              });
              visitInstanceURLs(rewrittenResource, (url, setURL) =>
                absolutizeInstanceURL(url, rewrittenResource.id, setURL),
              );
              visitModuleDeps(rewrittenResource, (url, setURL) =>
                absolutizeInstanceURL(url, rewrittenResource.id, setURL),
              );
              included.push(rewrittenResource);
            }
          }
        }
        let relationshipId = maybeURL(relationship.links.self, resource.id);
        if (!relationshipId) {
          throw new Error(
            `bug: unable to turn relative URL '${relationship.links.self}' into an absolute URL relative to ${resource.id}`,
          );
        }
        if (
          foundLinks ||
          omit.includes(relationshipId.href) ||
          included.find((i) => i.id === relationshipId!.href)
        ) {
          relationship.data = {
            type: linkResource?.type ?? CardResourceType,
            id: relationshipId.href,
          };
        } else if (!linkResource) {
          // Even when the linked resource is unavailable, ensure
          // relationship.data has the correct type so stale
          // pristine_doc entries (missing data.type) for file
          // relationships are not misidentified as card links.
          let fallbackRelationshipType:
            | typeof CardResourceType
            | typeof FileMetaResourceType;
          if (expectsFileMeta) {
            fallbackRelationshipType = FileMetaResourceType;
          } else {
            fallbackRelationshipType =
              (relationshipType as
                | typeof CardResourceType
                | typeof FileMetaResourceType
                | undefined) ?? CardResourceType;
          }
          relationship.data = {
            type: fallbackRelationshipType,
            id: relationshipId.href,
          };
        }
      }
    };

    await processRelationships();
    await this.populateQueryFields(resource, realmURL, opts);
    await processRelationships();
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

function relativizeDocument(doc: SingleCardDocument, realmURL: URL): void {
  let primarySelf = doc.data.links?.self ?? doc.data.id;
  if (!primarySelf) {
    return;
  }
  let primaryURL = new URL(primarySelf);
  relativizeResource(
    doc.data as unknown as LooseCardResource,
    primaryURL,
    realmURL,
  );
  if (doc.included) {
    for (let resource of doc.included) {
      relativizeResource(
        resource as unknown as LooseCardResource,
        primaryURL,
        realmURL,
      );
    }
  }
}

function relativizeResource(
  resource: LooseCardResource,
  primaryURL: URL,
  realmURL: URL,
) {
  visitInstanceURLs(resource, (url, setURL) => {
    let urlObj = new URL(url, resource.id ?? primaryURL);
    setURL(maybeRelativeURL(urlObj, primaryURL, realmURL));
  });
  visitModuleDeps(resource, (moduleURL, setModuleURL) => {
    let absoluteModuleURL = new URL(moduleURL, resource.id ?? primaryURL);
    setModuleURL(maybeRelativeURL(absoluteModuleURL, primaryURL, realmURL));
  });
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
          module: `${baseRealm.url}file-api`,
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
    id: fileURL.href,
    type: 'file-meta',
    attributes: {
      ...attributes,
    },
    meta: {
      adoptsFrom,
      realmURL: fileEntry.realmURL,
    },
    links: { self: fileURL.href },
  };
}
