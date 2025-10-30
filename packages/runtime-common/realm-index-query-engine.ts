import { Memoize } from 'typescript-memoize';
import { isScopedCSSRequest } from 'glimmer-scoped-css';
import {
  SupportedMimeType,
  maxLinkDepth,
  maybeURL,
  IndexQueryEngine,
  codeRefWithAbsoluteURL,
  type LooseCardResource,
  type DBAdapter,
  type QueryOptions,
  type IndexedModuleOrError,
  type IndexedDefinitionOrError,
  type InstanceOrError,
  type ResolvedCodeRef,
  type DefinitionLookup,
} from '.';
import type { Realm } from './realm';
import { RealmPaths } from './paths';
import { buildQueryString, type Query } from './query';
import { CardError, type SerializedError } from './error';
import { isResolvedCodeRef } from './code-ref';
import {
  isCardCollectionDocument,
  isSingleCardDocument,
  type SingleCardDocument,
  type CardCollectionDocument,
} from './document-types';
import type { CardResource, Saved } from './resource-types';
import type { DefinitionsCache } from './definitions-cache';
import type { FieldDefinition } from './index-structure';

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

const THIS_INTERPOLATION_PREFIX = '$this.';
const THIS_REALM_TOKEN = '$thisRealm';
const EMPTY_PREDICATE_KEYS = new Set([
  'eq',
  'contains',
  'range',
  'any',
  'every',
]);

export class RealmIndexQueryEngine {
  #realm: Realm;
  #fetch: typeof globalThis.fetch;
  #indexQueryEngine: IndexQueryEngine;

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
    return { type: 'doc', doc };
  }

  async module(
    url: URL,
    opts?: Options,
  ): Promise<IndexedModuleOrError | undefined> {
    return await this.#indexQueryEngine.getModule(url, opts);
  }

  async getOwnDefinition(
    codeRef: ResolvedCodeRef,
    opts?: Options,
  ): Promise<IndexedDefinitionOrError | undefined> {
    return await this.#indexQueryEngine.getOwnDefinition(codeRef, opts);
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
    let definitionEntry = await this.#indexQueryEngine.getOwnDefinition(
      codeRef,
      opts,
    );
    if (!definitionEntry || definitionEntry.type !== 'definition') {
      return;
    }

    let definition = definitionEntry.definition;
    for (let [fieldName, fieldDefinition] of Object.entries(
      definition.fields,
    )) {
      let metaQuery =
        (resource.meta as any)?.queryFields?.[fieldName] ?? undefined;
      let queryDefinition = this.getQueryDefinition(fieldDefinition, metaQuery);

      if (
        fieldName.includes('.') ||
        (fieldDefinition.type !== 'linksTo' &&
          fieldDefinition.type !== 'linksToMany') ||
        !queryDefinition
      ) {
        continue;
      }

      let results = await this.executeQueryForField({
        fieldDefinition,
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
      });
    }
  }

  private async executeQueryForField({
    fieldDefinition,
    queryDefinition,
    resource,
    realmURL,
    opts,
  }: {
    fieldDefinition: FieldDefinition;
    queryDefinition: Query;
    resource: LooseCardResource;
    realmURL: URL;
    opts?: Options;
  }): Promise<CardResource<Saved>[]> {
    let normalized = this.normalizeQueryDefinition(
      fieldDefinition,
      queryDefinition,
      resource,
      realmURL,
    );
    if (!normalized) {
      return [];
    }

    let { query, realms } = normalized;
    let aggregated: CardResource<Saved>[] = [];
    let seen = new Set<string>();

    for (let realmHref of realms) {
      let realmResults: CardResource<Saved>[] = [];
      if (realmHref === this.realmURL.href) {
        let collection = await this.#indexQueryEngine.search(
          this.realmURL,
          query,
          opts,
        );
        realmResults = Array.isArray(collection.cards) ? collection.cards : [];
      } else {
        let remoteResults = await this.fetchRemoteQueryResults(
          realmHref,
          query,
        );
        realmResults = Array.isArray(remoteResults) ? remoteResults : [];
      }

      for (let card of realmResults) {
        if (!card.id || seen.has(card.id)) {
          continue;
        }
        seen.add(card.id);
        aggregated.push(card);
      }
    }
    return aggregated;
  }

  private normalizeQueryDefinition(
    fieldDefinition: FieldDefinition,
    queryDefinition: Query,
    resource: LooseCardResource,
    realmURL: URL,
  ): { query: Query; realms: string[] } | null {
    let workingQuery: Query = JSON.parse(JSON.stringify(queryDefinition));
    let queryAny = workingQuery as Record<string, any>;
    let aborted = false;

    const markEmptyPredicate = (context?: string) => {
      if (context && EMPTY_PREDICATE_KEYS.has(context)) {
        aborted = true;
      }
    };

    const interpolateNode = (node: any, context?: string): any => {
      if (aborted) {
        return undefined;
      }

      if (typeof node === 'string') {
        if (node === THIS_REALM_TOKEN) {
          return realmURL.href;
        }
        if (node.startsWith(THIS_INTERPOLATION_PREFIX)) {
          let path = node.slice(THIS_INTERPOLATION_PREFIX.length);
          let value = this.getValueForPath(resource, path);
          if (value === undefined) {
            markEmptyPredicate(context);
            return undefined;
          }
          return value;
        }
        return node;
      }

      if (Array.isArray(node)) {
        let result: any[] = [];
        for (let entry of node) {
          let interpolated = interpolateNode(entry, context);
          if (interpolated !== undefined) {
            result.push(interpolated);
          }
        }
        if (result.length === 0) {
          markEmptyPredicate(context);
          return undefined;
        }
        return result;
      }

      if (node && typeof node === 'object') {
        let result: Record<string, any> = {};
        for (let [key, value] of Object.entries(node)) {
          let interpolated = interpolateNode(value, key);
          if (interpolated !== undefined) {
            result[key] = interpolated;
          }
        }
        if (Object.keys(result).length === 0) {
          markEmptyPredicate(context);
          return undefined;
        }
        return result;
      }

      return node;
    };

    if (queryAny.filter) {
      let interpolatedFilter = interpolateNode(queryAny.filter, 'filter');
      if (interpolatedFilter === undefined) {
        delete queryAny.filter;
      } else {
        queryAny.filter = interpolatedFilter;
      }
    }

    if (queryAny.sort) {
      let interpolatedSort = interpolateNode(queryAny.sort, 'sort');
      if (interpolatedSort === undefined) {
        delete queryAny.sort;
      } else {
        queryAny.sort = interpolatedSort;
      }
    }

    if (queryAny.page) {
      let interpolatedPage = interpolateNode(queryAny.page, 'page');
      if (interpolatedPage === undefined) {
        delete queryAny.page;
      } else {
        queryAny.page = interpolatedPage;
      }
    }

    let realmsList: any = queryAny.realms ?? [THIS_REALM_TOKEN];
    let interpolatedRealms = interpolateNode(realmsList, 'realms');
    if (interpolatedRealms !== undefined) {
      realmsList = interpolatedRealms;
    }
    delete queryAny.realms;

    if (aborted) {
      return null;
    }

    let resolvedRealms = (Array.isArray(realmsList) ? realmsList : [realmsList])
      .map((realm) => {
        if (typeof realm !== 'string') {
          return undefined;
        }
        if (realm === THIS_REALM_TOKEN) {
          return realmURL.href;
        }
        if (realm.startsWith(THIS_INTERPOLATION_PREFIX)) {
          let value = this.getValueForPath(
            resource,
            realm.slice(THIS_INTERPOLATION_PREFIX.length),
          );
          return typeof value === 'string' && value.length > 0
            ? value
            : undefined;
        }
        return realm;
      })
      .filter((realm): realm is string => typeof realm === 'string');

    if (resolvedRealms.length === 0) {
      resolvedRealms = [realmURL.href];
    }

    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      resource.id ? new URL(resource.id) : realmURL,
    );

    let filter = queryAny.filter as Record<string, any> | undefined;
    if (!filter) {
      filter = {};
      queryAny.filter = filter;
    }
    if (!filter.on) {
      filter.on = targetRef;
    }

    if (Array.isArray(queryAny.sort)) {
      queryAny.sort = queryAny.sort.map((entry: any) => {
        if (entry && typeof entry === 'object' && !('on' in entry)) {
          return { ...entry, on: targetRef };
        }
        return entry;
      });
    }

    if (fieldDefinition.type === 'linksTo') {
      let page = queryAny.page ?? {};
      page.size = 1;
      if (page.number == null) {
        page.number = 0;
      }
      queryAny.page = page;
    } else if (queryAny.page) {
      queryAny.page.number = queryAny.page.number ?? 0;
    }

    return { query: workingQuery, realms: resolvedRealms };
  }

  private getQueryDefinition(
    fieldDefinition: FieldDefinition,
    metaQuery: unknown,
  ): Query | undefined {
    if (fieldDefinition.query && typeof fieldDefinition.query === 'object') {
      return fieldDefinition.query as Query;
    }
    if (metaQuery && typeof metaQuery === 'object') {
      return metaQuery as Query;
    }
    return undefined;
  }

  private getValueForPath(resource: LooseCardResource, path: string): any {
    let root: any = {
      ...(resource.attributes ?? {}),
      id: resource.id,
    };
    let segments = path.split('.');
    let current: any = root;
    for (let segment of segments) {
      if (current == null) {
        return undefined;
      }
      if (Array.isArray(current)) {
        let index = Number(segment);
        if (!Number.isInteger(index)) {
          return undefined;
        }
        current = current[index];
        continue;
      }
      if (typeof current === 'object' && segment in current) {
        current = (current as any)[segment];
        continue;
      }
      return undefined;
    }
    return current;
  }

  private applyQueryResults({
    fieldDefinition,
    fieldName,
    resource,
    results,
  }: {
    fieldDefinition: FieldDefinition;
    fieldName: string;
    resource: LooseCardResource;
    results: CardResource<Saved>[];
  }): void {
    resource.relationships = resource.relationships ?? {};
    for (let key of Object.keys(resource.relationships)) {
      if (key === fieldName || key.startsWith(`${fieldName}.`)) {
        delete resource.relationships[key];
      }
    }

    if (fieldDefinition.type === 'linksTo') {
      let first = results[0];
      if (!first || !first.id) {
        resource.relationships[fieldName] = {
          links: { self: null },
        };
        return;
      }
      resource.relationships[fieldName] = {
        links: { self: first.id },
        data: { type: 'card', id: first.id },
      };
      return;
    }

    if (results.length === 0) {
      resource.relationships[fieldName] = {
        links: { self: null },
      };
      return;
    }

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
  ): Promise<CardResource<Saved>[]> {
    try {
      let baseHref = realmHref.endsWith('/') ? realmHref : `${realmHref}/`;
      let searchURL = new URL('./_search', baseHref);
      searchURL.search = buildQueryString(query);
      let response = await this.#fetch(searchURL.href, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      if (!response.ok) {
        return [];
      }
      let json = await response.json();
      if (!isCardCollectionDocument(json)) {
        return [];
      }
      return json.data;
    } catch (_err) {
      return [];
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
              included.push({
                ...includedResource,
                ...{ links: { self: includedResource.id } },
              });
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
          (relationshipId &&
            included.find((i) => i.id === relationshipId!.href))
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
