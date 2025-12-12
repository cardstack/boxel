import { Memoize } from 'typescript-memoize';
import { isScopedCSSRequest } from 'glimmer-scoped-css';
import cloneDeep from 'lodash/cloneDeep';
import {
  SupportedMimeType,
  maxLinkDepth,
  maybeURL,
  IndexQueryEngine,
  codeRefWithAbsoluteURL,
  logger,
  type LooseCardResource,
  type DBAdapter,
  type QueryOptions,
  type IndexedModuleOrError,
  type InstanceOrError,
  type DefinitionLookup,
  visitInstanceURLs,
  maybeRelativeURL,
} from '.';
import type { Realm } from './realm';
import { RealmPaths } from './paths';
import { buildQueryString, type Query } from './query';
import { CardError, type SerializedError } from './error';
import { isResolvedCodeRef, visitModuleDeps } from './code-ref';
import {
  isCardCollectionDocument,
  isSingleCardDocument,
  type SingleCardDocument,
  type CardCollectionDocument,
} from './document-types';
import type { CardResource, Saved } from './resource-types';
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

  async search(query: Query, opts?: Options): Promise<CardCollectionDocument> {
    let doc: CardCollectionDocument;
    let { cards: data, meta } = await this.#indexQueryEngine.search(
      new URL(this.#realm.url),
      query,
      opts,
    );
    doc = {
      data: data.map((resource) => ({
        ...resource,
        ...{ links: { self: resource.id } },
      })),
      meta,
    };

    let omit = doc.data.map((r) => r.id).filter(Boolean) as string[];
    // TODO eventually the links will be cached in the index, and this will only
    // fill in the included resources for links that were not cached (e.g.
    // volatile fields)
    if (opts?.loadLinks) {
      let included: CardResource<Saved>[] = [];
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
    if (instance.type === 'error') {
      let scopedCssUrls = (instance.deps ?? []).filter(isScopedCSSRequest);
      return {
        type: 'error',
        error: {
          errorDetail: instance.error,
          scopedCssUrls,
          lastKnownGoodHtml: instance.isolatedHtml ?? null,
          cardTitle: instance.searchDoc?.title ?? null,
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

  private async populateQueryFields(
    resource: LooseCardResource,
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
    resource: LooseCardResource;
    realmURL: URL;
    opts?: Options;
  }): Promise<{
    results: CardResource<Saved>[];
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
    let aggregated: CardResource<Saved>[] = [];
    let seen = new Set<string>();
    let errors: QueryFieldErrorDetail[] = [];

    let realmResults: CardResource<Saved>[] = [];
    if (realm === this.realmURL.href) {
      try {
        let collection = await this.#indexQueryEngine.search(
          this.realmURL,
          query,
          opts,
        );
        realmResults = Array.isArray(collection.cards) ? collection.cards : [];
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

    for (let card of realmResults) {
      if (!card?.id || seen.has(card.id)) {
        continue;
      }
      seen.add(card.id);
      aggregated.push(card);
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
    resource: LooseCardResource;
    results: CardResource<Saved>[];
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
          relationship.data = { type: 'card', id: first.id };
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
            .map((card) => ({ type: 'card', id: card.id }))
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
        data: { type: 'card', id: card.id },
      };
    });
  }

  private async fetchRemoteQueryResults(
    realmHref: string,
    query: Query,
  ): Promise<{ cards: CardResource<Saved>[]; error?: QueryFieldErrorDetail }> {
    try {
      let baseHref = realmHref.endsWith('/') ? realmHref : `${realmHref}/`;
      let searchURL = new URL('./_search', baseHref);
      searchURL.search = buildQueryString(query);
      let response = await this.#fetch(searchURL.href, {
        headers: { Accept: SupportedMimeType.CardJson },
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
      if (!isCardCollectionDocument(json)) {
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
      resource: LooseCardResource;
      omit?: string[];
      included?: CardResource<Saved>[];
      visited?: string[];
      stack?: string[];
    },
    opts?: Options,
  ): Promise<CardResource<Saved>[]> {
    if (resource.id != null) {
      if (visited.includes(resource.id)) {
        return [];
      }
      visited.push(resource.id);
    }
    let realmPath = new RealmPaths(realmURL);
    let processedRelationships = new Set<string>();
    let processRelationships = async () => {
      for (let [fieldName, relationship] of Object.entries(
        resource.relationships ?? {},
      )) {
        if (processedRelationships.has(fieldName)) {
          continue;
        }
        if (!relationship.links?.self) {
          continue;
        }
        processedRelationships.add(fieldName);
        let linkURL = new URL(
          relationship.links.self,
          resource.id ? new URL(resource.id) : realmURL,
        );
        let linkResource: CardResource<Saved> | undefined;
        if (realmPath.inRealm(linkURL)) {
          let maybeResult = await this.#indexQueryEngine.getInstance(
            linkURL,
            opts,
          );
          linkResource =
            maybeResult?.type === 'instance' ? maybeResult.instance : undefined;
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
              } is not a card document. it is: ${JSON.stringify(json, null, 2)}`,
            );
          }
          linkResource = { ...json.data, ...{ links: { self: json.data.id } } };
        }
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
>>>>>>> main
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
          resource.relationships![fieldName].data = {
            type: 'card',
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
