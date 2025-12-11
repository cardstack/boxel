import { Memoize } from 'typescript-memoize';
import { isScopedCSSRequest } from 'glimmer-scoped-css';
import cloneDeep from 'lodash/cloneDeep';
import {
  SupportedMimeType,
  maxLinkDepth,
  maybeURL,
  IndexQueryEngine,
  type LooseCardResource,
  type DBAdapter,
  type QueryOptions,
  type IndexedModuleOrError,
  type IndexedDefinitionOrError,
  type InstanceOrError,
  type ResolvedCodeRef,
  type DefinitionLookup,
  visitInstanceURLs,
  maybeRelativeURL,
} from '.';
import type { Realm } from './realm';
import { RealmPaths } from './paths';
import type { Query } from './query';
import { CardError, type SerializedError } from './error';
import { visitModuleDeps } from './code-ref';
import {
  isSingleCardDocument,
  type SingleCardDocument,
  type CardCollectionDocument,
} from './document-types';
import type { CardResource, Saved } from './resource-types';

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
    relativizeDocument(doc, this.realmURL);
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
    for (let [fieldName, relationship] of Object.entries(
      resource.relationships ?? {},
    )) {
      if (!relationship.links?.self) {
        continue;
      }
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
            let rewrittenResource = cloneDeep({
              ...includedResource,
              ...{ links: { self: includedResource.id } },
            });
            function visitURL(url: string, setURL: (newURL: string) => void) {
              setURL(new URL(url, rewrittenResource.id).href);
            }
            visitInstanceURLs(rewrittenResource, visitURL);
            visitModuleDeps(rewrittenResource, visitURL);
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
        (relationshipId && included.find((i) => i.id === relationshipId!.href))
      ) {
        resource.relationships![fieldName].data = {
          type: 'card',
          id: relationshipId.href,
        };
      }
    }
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
