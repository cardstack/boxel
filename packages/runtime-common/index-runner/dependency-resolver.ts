import type {
  DependencyIndexRow,
  SearchIndexErrorEntry,
  SingleCardDocument,
} from '../index.ts';
import type { DefinitionCacheEntries } from '../definition-lookup.ts';
import type { SerializedError } from '../error.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { canonicalURL, type CanonicalURLMemo } from './dependency-url.ts';
import { IndexBackedDependencyErrors } from './index-backed-dependency-errors.ts';
import {
  RelationshipDependencyExtractor,
  type RelationshipSource,
} from './relationship-dependency-extractor.ts';

type OrderingDependencyRow = Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>;

interface DependencyResolverOptions {
  realmURL: URL;
  virtualNetwork: VirtualNetwork;
  readDefinitionCacheEntries(
    moduleIds: string[],
  ): Promise<DefinitionCacheEntries>;
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
  #virtualNetwork: VirtualNetwork;
  // Shared across invalidation ordering, relationship extraction, and
  // index-backed error lookup so the module/relationship deps that recur on
  // nearly every card in a realm are canonicalized once per index pass rather
  // than on every `(row, dep)` pair. Cleared at each pass boundary by `reset()`.
  #canonicalURLMemo: CanonicalURLMemo = new Map();

  constructor({
    realmURL,
    virtualNetwork,
    readDefinitionCacheEntries,
    getDependencyRows,
    getOrderingDependencyRows,
    getInvalidations,
  }: DependencyResolverOptions) {
    this.#getOrderingDependencyRows = getOrderingDependencyRows;
    this.#virtualNetwork = virtualNetwork;
    this.#indexBackedDependencyErrors = new IndexBackedDependencyErrors({
      realmURL,
      virtualNetwork,
      readDefinitionCacheEntries,
      getDependencyRows,
      getInvalidations,
      canonicalURLMemo: this.#canonicalURLMemo,
    });
    this.#relationshipDependencyExtractor = new RelationshipDependencyExtractor(
      {
        realmURL,
        virtualNetwork,
        canonicalURLMemo: this.#canonicalURLMemo,
      },
    );
  }

  reset(): void {
    this.#canonicalURLMemo.clear();
    this.#indexBackedDependencyErrors.reset();
  }

  // Canonical form of `url` relative to `relativeTo`, sharing the pass-scoped
  // cache with invalidation ordering and index-backed error lookup.
  canonicalURL(url: string, relativeTo: string | undefined): string {
    return canonicalURL(
      url,
      relativeTo,
      this.#virtualNetwork,
      this.#canonicalURLMemo,
    );
  }

  invalidateRelationshipDependencyRowCache(url: URL): void {
    this.#indexBackedDependencyErrors.invalidateRelationshipDependencyRowCache(
      url,
    );
  }

  // Topologically order an invalidation set so a URL is visited after every
  // URL it depends on, using the `deps` rows the index has persisted.
  //
  // The incoming order is the priority: among the URLs whose dependencies
  // are all satisfied, the one that arrived earliest goes first. Callers
  // therefore express a preference by the order they pass, and get it
  // wherever a recorded dependency does not overrule it. The incremental
  // pass leads its input with the URLs its triggering write named
  // (`prioritizeWrittenURLs`).
  //
  // A dependency cycle has no topological order, so the edges running
  // through one are dropped and its members are scheduled by priority
  // alongside everything else (see `#edgesWithinCyclesDropped`). Dropping
  // them costs nothing a cycle had not already cost — no order satisfies
  // every edge in a cycle — and it is what keeps priority meaningful for a
  // URL caught in one: otherwise a cycle member could never be scheduled
  // until every acyclic URL had been, however high its priority. A URL that
  // merely depends on a cycle member is not itself in the cycle, so its edge
  // survives and it still waits.
  async orderInvalidationsByDependencies(urls: URL[]): Promise<URL[]> {
    if (urls.length < 2) {
      return urls;
    }

    let byHref = new Map(urls.map((url) => [url.href, url]));
    let hrefs = [...byHref.keys()];
    let order = new Map(hrefs.map((href, index) => [href, index]));
    let rows = await this.#getOrderingDependencyRows(hrefs);

    // dependency -> the URLs in this set that depend on it. Indegrees are
    // derived from these edges by `#kahnByPriority`, over the reduced edge
    // set that survives the cycle drop below.
    let edges = new Map<string, Set<string>>();
    for (let row of rows) {
      if (!byHref.has(row.url)) {
        continue;
      }
      let base = new URL(row.url);
      for (let dep of row.deps ?? []) {
        let normalized = this.canonicalURL(dep, base.href);
        if (!byHref.has(normalized) || normalized === row.url) {
          continue;
        }
        let dependents = edges.get(normalized);
        if (!dependents) {
          dependents = new Set<string>();
          edges.set(normalized, dependents);
        }
        dependents.add(row.url);
      }
    }

    // Only the edges INSIDE a cycle are unsatisfiable, so only those are
    // dropped. Scoping the drop to a strongly-connected component is what
    // keeps a URL that merely sits *behind* a cycle waiting for its
    // dependency: its incoming edge comes from a cycle member but crosses
    // out of that component, so it survives and still orders the pair. The
    // condensation of a digraph by its components is a DAG, so what remains
    // always schedules completely.
    let ordered = this.#kahnByPriority(
      hrefs,
      this.#edgesWithinCyclesDropped(hrefs, edges),
      order,
    );
    // Belt and braces: a URL the scheduler somehow still could not place is
    // appended rather than dropped, because losing one from the visit list
    // would leave its tombstone to be promoted.
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

  // `edges` minus the edges whose endpoints share a strongly-connected
  // component of more than one URL — that is, minus exactly the edges a
  // dependency cycle runs through. Every other edge, including one leading
  // out of a cycle into a URL that depends on it, is preserved.
  #edgesWithinCyclesDropped(
    hrefs: string[],
    edges: Map<string, Set<string>>,
  ): Map<string, Set<string>> {
    let { componentOf, componentSize } = this.#stronglyConnectedComponents(
      hrefs,
      edges,
    );
    let kept = new Map<string, Set<string>>();
    for (let [dependency, dependents] of edges) {
      let component = componentOf.get(dependency);
      let inCycle =
        component !== undefined && (componentSize.get(component) ?? 1) > 1;
      let keptDependents = inCycle
        ? new Set(
            [...dependents].filter(
              (dependent) => componentOf.get(dependent) !== component,
            ),
          )
        : dependents;
      if (keptDependents.size > 0) {
        kept.set(dependency, keptDependents);
      }
    }
    return kept;
  }

  // Tarjan's strongly-connected components, iterative so a deep dependency
  // graph cannot overflow the stack. Two URLs share a component id exactly
  // when each is reachable from the other — i.e. they sit in one cycle. A
  // URL in no cycle gets a component of its own, of size 1.
  #stronglyConnectedComponents(
    hrefs: string[],
    edges: Map<string, Set<string>>,
  ): {
    componentOf: Map<string, number>;
    componentSize: Map<number, number>;
  } {
    let visitIndex = new Map<string, number>();
    let lowLink = new Map<string, number>();
    let onStack = new Set<string>();
    let componentStack: string[] = [];
    let componentOf = new Map<string, number>();
    let componentSize = new Map<number, number>();
    let nextIndex = 0;
    let nextComponent = 0;

    for (let root of hrefs) {
      if (visitIndex.has(root)) {
        continue;
      }
      let frames: { href: string; dependents: string[]; cursor: number }[] = [];
      let enter = (href: string) => {
        visitIndex.set(href, nextIndex);
        lowLink.set(href, nextIndex);
        nextIndex++;
        componentStack.push(href);
        onStack.add(href);
        frames.push({
          href,
          dependents: [...(edges.get(href) ?? [])],
          cursor: 0,
        });
      };
      enter(root);
      while (frames.length > 0) {
        let frame = frames[frames.length - 1]!;
        if (frame.cursor < frame.dependents.length) {
          let dependent = frame.dependents[frame.cursor++]!;
          if (!visitIndex.has(dependent)) {
            enter(dependent);
          } else if (onStack.has(dependent)) {
            lowLink.set(
              frame.href,
              Math.min(lowLink.get(frame.href)!, visitIndex.get(dependent)!),
            );
          }
          continue;
        }
        frames.pop();
        if (lowLink.get(frame.href) === visitIndex.get(frame.href)) {
          let component = nextComponent++;
          let size = 0;
          for (;;) {
            let member = componentStack.pop()!;
            onStack.delete(member);
            componentOf.set(member, component);
            size++;
            if (member === frame.href) {
              break;
            }
          }
          componentSize.set(component, size);
        }
        let parent = frames[frames.length - 1];
        if (parent) {
          lowLink.set(
            parent.href,
            Math.min(lowLink.get(parent.href)!, lowLink.get(frame.href)!),
          );
        }
      }
    }
    return { componentOf, componentSize };
  }

  // Kahn's algorithm with a priority queue keyed on `order`: of the URLs
  // whose dependencies are all scheduled, the lowest-`order` one goes next.
  #kahnByPriority(
    hrefs: string[],
    edges: Map<string, Set<string>>,
    order: Map<string, number>,
  ): string[] {
    let indegree = new Map<string, number>();
    for (let href of hrefs) {
      indegree.set(href, 0);
    }
    for (let dependents of edges.values()) {
      for (let dependent of dependents) {
        indegree.set(dependent, (indegree.get(dependent) ?? 0) + 1);
      }
    }

    let priorityOf = (href: string) =>
      order.get(href) ?? Number.MAX_SAFE_INTEGER;
    let queue = hrefs
      .filter((href) => (indegree.get(href) ?? 0) === 0)
      .sort((a, b) => priorityOf(a) - priorityOf(b));
    let insertByOrder = (href: string) => {
      let priority = priorityOf(href);
      let low = 0;
      let high = queue.length;
      while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (priorityOf(queue[mid]!) <= priority) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      queue.splice(low, 0, href);
    };

    let ordered: string[] = [];
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
    return ordered;
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
