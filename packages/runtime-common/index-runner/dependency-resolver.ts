import type {
  DependencyIndexRow,
  SearchIndexErrorEntry,
  SingleCardDocument,
} from '../index';
import type { ModuleCacheEntries } from '../definition-lookup';
import type { SerializedError } from '../error';
import { canonicalURL } from './dependency-url';
import { IndexBackedDependencyErrors } from './index-backed-dependency-errors';
import {
  RelationshipDependencyExtractor,
  type RelationshipSource,
} from './relationship-dependency-extractor';

interface DependencyResolverOptions {
  realmURL: URL;
  readModuleCacheEntries(moduleIds: string[]): Promise<ModuleCacheEntries>;
  getDependencyRows(urls: string[]): Promise<DependencyIndexRow[]>;
  getInvalidations(): string[];
}

/**
 * Dependency policy for index-runner:
 * - Runtime-captured deps are the source of truth for persisted `deps` rows.
 * - This manager only does index-backed lookups where runtime capture cannot:
 *   1) invalidation ordering over persisted dependency rows
 *   2) dependency error fan-out by reading existing index/module-cache errors
 * - Relationship extraction helpers here are direct-edge fallbacks for error
 *   paths when runtime capture can be incomplete (short-circuit failures).
 */
export class IndexRunnerDependencyManager {
  #getDependencyRows: (urls: string[]) => Promise<DependencyIndexRow[]>;
  #indexBackedDependencyErrors: IndexBackedDependencyErrors;
  #relationshipDependencyExtractor: RelationshipDependencyExtractor;

  constructor({
    realmURL,
    readModuleCacheEntries,
    getDependencyRows,
    getInvalidations,
  }: DependencyResolverOptions) {
    this.#getDependencyRows = getDependencyRows;
    this.#indexBackedDependencyErrors = new IndexBackedDependencyErrors({
      realmURL,
      readModuleCacheEntries,
      getDependencyRows,
      getInvalidations,
    });
    this.#relationshipDependencyExtractor = new RelationshipDependencyExtractor(
      {
        realmURL,
      },
    );
  }

  reset(): void {
    this.#indexBackedDependencyErrors.reset();
  }

  invalidateRelationshipDependencyRowCache(url: URL): void {
    this.#indexBackedDependencyErrors.invalidateRelationshipDependencyRowCache(
      url,
    );
  }

  async orderInvalidationsByDependencies(urls: URL[]): Promise<URL[]> {
    if (urls.length < 2) {
      return urls;
    }

    let byHref = new Map(urls.map((url) => [url.href, url]));
    let hrefs = [...byHref.keys()];
    let order = new Map(hrefs.map((href, index) => [href, index]));
    let rows = await this.#getDependencyRows(hrefs);

    let edges = new Map<string, Set<string>>();
    let indegree = new Map<string, number>();
    for (let href of hrefs) {
      indegree.set(href, 0);
    }

    for (let row of rows) {
      if (!byHref.has(row.url)) {
        continue;
      }
      let base = new URL(row.url);
      for (let dep of row.deps ?? []) {
        let normalized = canonicalURL(dep, base.href);
        if (!byHref.has(normalized) || normalized === row.url) {
          continue;
        }
        let dependents = edges.get(normalized);
        if (!dependents) {
          dependents = new Set<string>();
          edges.set(normalized, dependents);
        }
        if (!dependents.has(row.url)) {
          dependents.add(row.url);
          indegree.set(row.url, (indegree.get(row.url) ?? 0) + 1);
        }
      }
    }

    let queue = hrefs
      .filter((href) => (indegree.get(href) ?? 0) === 0)
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    let ordered: string[] = [];
    let insertByOrder = (href: string) => {
      let priority = order.get(href) ?? Number.MAX_SAFE_INTEGER;
      let low = 0;
      let high = queue.length;
      while (low < high) {
        let mid = Math.floor((low + high) / 2);
        let midPriority = order.get(queue[mid]!) ?? Number.MAX_SAFE_INTEGER;
        if (midPriority <= priority) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      queue.splice(low, 0, href);
    };

    while (queue.length > 0) {
      let href = queue.shift()!;
      ordered.push(href);
      for (let dependent of edges.get(href) ?? []) {
        let next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          insertByOrder(dependent);
        }
      }
    }

    if (ordered.length !== hrefs.length) {
      let orderedSet = new Set(ordered);
      for (let href of hrefs) {
        if (!orderedSet.has(href)) {
          ordered.push(href);
          orderedSet.add(href);
        }
      }
    }

    return ordered
      .map((href) => byHref.get(href))
      .filter((url): url is URL => Boolean(url));
  }

  extractDirectRelationshipDeps(
    resource: RelationshipSource,
    relativeTo: URL,
  ): Set<string> {
    return this.#relationshipDependencyExtractor.extractDirectRelationshipDeps(
      resource,
      relativeTo,
    );
  }

  extractSearchDocRelationshipDeps(
    searchDoc: Record<string, unknown> | null | undefined,
    relativeTo: URL,
    queryFieldPaths?: Set<string>,
  ): Set<string> {
    return this.#relationshipDependencyExtractor.extractSearchDocRelationshipDeps(
      searchDoc,
      relativeTo,
      queryFieldPaths,
    );
  }

  extractSerializedRelationshipDeps(
    serialized: SingleCardDocument | null | undefined,
    relativeTo: URL,
  ): Set<string> {
    return this.#relationshipDependencyExtractor.extractSerializedRelationshipDeps(
      serialized,
      relativeTo,
    );
  }

  extractQueryFieldRelationshipPaths(
    ...resources: RelationshipSource[]
  ): Set<string> {
    return this.#relationshipDependencyExtractor.extractQueryFieldRelationshipPaths(
      ...resources,
    );
  }

  async indexBackedDependencyErrorForEntry(
    deps: Iterable<string>,
    relativeTo: URL,
  ): Promise<SerializedError | undefined> {
    return await this.#indexBackedDependencyErrors.indexBackedDependencyErrorForEntry(
      deps,
      relativeTo,
    );
  }

  async appendIndexBackedDependencyErrors<T extends SearchIndexErrorEntry>(
    entry: T,
    entryURL: URL,
  ): Promise<T> {
    return await this.#indexBackedDependencyErrors.appendIndexBackedDependencyErrors(
      entry,
      entryURL,
    );
  }
}
