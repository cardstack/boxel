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

type OrderingDependencyRow = Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>;

export interface OrderedInvalidations {
  ordered: URL[];
  // Largest count of nodes sharing the same topological depth. The
  // index-runner uses this as the upper bound on useful per-batch
  // visit concurrency: spawning more parallel visits than the widest
  // layer wastes resources because the extra workers have no eligible
  // work to take.
  maxLayerWidth: number;
  // Number of distinct topological layers (1 + longest dep chain
  // length). When this is close to `ordered.length` the graph is
  // essentially linear and parallelism can't help.
  topoDepth: number;
}

interface DependencyResolverOptions {
  realmURL: URL;
  readModuleCacheEntries(moduleIds: string[]): Promise<ModuleCacheEntries>;
  getDependencyRows(urls: string[]): Promise<DependencyIndexRow[]>;
  // Slim projection (url, type, deps only) used by invalidation ordering.
  // Selection priority is applied server-side; see IndexWriter.
  getOrderingDependencyRows(urls: string[]): Promise<OrderingDependencyRow[]>;
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
  #getOrderingDependencyRows: (
    urls: string[],
  ) => Promise<OrderingDependencyRow[]>;
  #indexBackedDependencyErrors: IndexBackedDependencyErrors;
  #relationshipDependencyExtractor: RelationshipDependencyExtractor;

  constructor({
    realmURL,
    readModuleCacheEntries,
    getDependencyRows,
    getOrderingDependencyRows,
    getInvalidations,
  }: DependencyResolverOptions) {
    this.#getOrderingDependencyRows = getOrderingDependencyRows;
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

  async orderInvalidationsByDependencies(
    urls: URL[],
  ): Promise<OrderedInvalidations> {
    if (urls.length === 0) {
      return { ordered: urls, maxLayerWidth: 0, topoDepth: 0 };
    }
    if (urls.length === 1) {
      return { ordered: urls, maxLayerWidth: 1, topoDepth: 1 };
    }

    let byHref = new Map(urls.map((url) => [url.href, url]));
    let hrefs = [...byHref.keys()];
    let order = new Map(hrefs.map((href, index) => [href, index]));
    let rows = await this.#getOrderingDependencyRows(hrefs);

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

    // Layer assignment: each href's layer is one greater than the max
    // layer of any of its prerequisites. Roots (indegree 0) live in
    // layer 0. We use this only to report `maxLayerWidth` / `topoDepth`
    // for the caller's parallelism-sizing decision — the actual visit
    // order produced below is a stable priority-queue traversal that
    // honors the input ordering, not a strict layered ordering.
    let layerOf = new Map<string, number>();
    for (let href of hrefs) {
      if ((indegree.get(href) ?? 0) === 0) {
        layerOf.set(href, 0);
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
      let myLayer = layerOf.get(href) ?? 0;
      for (let dependent of edges.get(href) ?? []) {
        let next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        let prev = layerOf.get(dependent);
        let candidate = myLayer + 1;
        if (prev === undefined || candidate > prev) {
          layerOf.set(dependent, candidate);
        }
        if (next === 0) {
          insertByOrder(dependent);
        }
      }
    }

    // Items that didn't make it into `ordered` (e.g. participants in a
    // dependency cycle) get appended in input order so the caller still
    // sees every URL. Assign them to the deepest layer + 1 so they
    // contribute to width / depth in a way that doesn't surprise the
    // sizing formula.
    let cycleLayer = 0;
    for (let depth of layerOf.values()) {
      if (depth > cycleLayer) {
        cycleLayer = depth;
      }
    }
    cycleLayer += 1;
    if (ordered.length !== hrefs.length) {
      let orderedSet = new Set(ordered);
      for (let href of hrefs) {
        if (!orderedSet.has(href)) {
          ordered.push(href);
          orderedSet.add(href);
          if (!layerOf.has(href)) {
            layerOf.set(href, cycleLayer);
          }
        }
      }
    }

    let widthByLayer = new Map<number, number>();
    for (let depth of layerOf.values()) {
      widthByLayer.set(depth, (widthByLayer.get(depth) ?? 0) + 1);
    }
    let maxLayerWidth = 0;
    for (let width of widthByLayer.values()) {
      if (width > maxLayerWidth) {
        maxLayerWidth = width;
      }
    }
    let topoDepth = widthByLayer.size;

    return {
      ordered: ordered
        .map((href) => byHref.get(href))
        .filter((url): url is URL => Boolean(url)),
      maxLayerWidth,
      topoDepth,
    };
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
