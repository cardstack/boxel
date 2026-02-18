import {
  extractRelationshipIds,
  trimExecutableExtension,
  type CardResource,
  type DependencyIndexRow,
  type FileMetaResource,
  type SearchIndexErrorEntry,
  type SingleCardDocument,
} from '../index';
import type { ModuleCacheEntries } from '../definition-lookup';
import type { SerializedError } from '../error';

interface DependencyResolverOptions {
  realmURL: URL;
  readModuleCacheEntries(moduleIds: string[]): Promise<ModuleCacheEntries>;
  getDependencyRows(urls: string[]): Promise<DependencyIndexRow[]>;
  getInvalidations(): string[];
}

type RelationshipSource =
  | Pick<CardResource, 'relationships'>
  | FileMetaResource
  | null
  | undefined;

export function canonicalURL(url: string, relativeTo?: string): string {
  try {
    let parsed = new URL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}

export class IndexRunnerDependencyResolver {
  #realmURL: URL;
  #readModuleCacheEntries: (moduleIds: string[]) => Promise<ModuleCacheEntries>;
  #getDependencyRows: (urls: string[]) => Promise<DependencyIndexRow[]>;
  #getInvalidations: () => string[];
  #relationshipDependencyRows = new Map<string, DependencyIndexRow[]>();

  constructor({
    realmURL,
    readModuleCacheEntries,
    getDependencyRows,
    getInvalidations,
  }: DependencyResolverOptions) {
    this.#realmURL = realmURL;
    this.#readModuleCacheEntries = readModuleCacheEntries;
    this.#getDependencyRows = getDependencyRows;
    this.#getInvalidations = getInvalidations;
  }

  reset(): void {
    this.#relationshipDependencyRows.clear();
  }

  invalidateRelationshipDependencyRowCache(url: URL): void {
    let canonical = canonicalURL(url.href, this.#realmURL.href);
    this.#relationshipDependencyRows.delete(canonical);
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
        let normalized = this.normalizeStoredDependency(dep, base);
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
      for (let href of hrefs) {
        if (!ordered.includes(href)) {
          ordered.push(href);
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
    let deps = new Set<string>();
    let relationships = resource?.relationships;
    if (!relationships) {
      return deps;
    }

    for (let value of Object.values(relationships)) {
      let entries = Array.isArray(value) ? value : [value];
      for (let relationship of entries) {
        this.addRelationshipDependencyCandidates(
          deps,
          relationship,
          relativeTo,
        );
      }
    }

    return deps;
  }

  extractSearchDocRelationshipDeps(
    searchDoc: Record<string, unknown> | null | undefined,
    relativeTo: URL,
  ): Set<string> {
    let deps = new Set<string>();
    if (!searchDoc) {
      return deps;
    }

    let selfUrls = new Set<string>();
    let canonicalSelf = canonicalURL(relativeTo.href, relativeTo.href);
    selfUrls.add(canonicalSelf);
    selfUrls.add(
      this.normalizeRelationshipDependency(canonicalSelf, relativeTo),
    );
    if (canonicalSelf.endsWith('.json')) {
      selfUrls.add(canonicalSelf.replace(/\.json$/, ''));
    } else {
      selfUrls.add(`${canonicalSelf}.json`);
    }

    let visited = new Set<unknown>();
    let visit = (value: unknown) => {
      if (value == null || typeof value !== 'object') {
        return;
      }
      if (visited.has(value)) {
        return;
      }
      visited.add(value);

      if (Array.isArray(value)) {
        for (let item of value) {
          visit(item);
        }
        return;
      }

      let maybeId = (value as { id?: unknown }).id;
      if (typeof maybeId === 'string') {
        let normalized = this.normalizeRelationshipDependency(
          maybeId,
          relativeTo,
        );
        if (normalized && !selfUrls.has(normalized)) {
          deps.add(normalized);
        }
      }

      for (let nested of Object.values(value as Record<string, unknown>)) {
        visit(nested);
      }
    };

    visit(searchDoc);
    return deps;
  }

  extractSerializedRelationshipDeps(
    serialized: SingleCardDocument | null | undefined,
    relativeTo: URL,
  ): Set<string> {
    let deps = new Set<string>();
    if (!serialized) {
      return deps;
    }

    let addDep = (id: string) => {
      let normalized = this.normalizeRelationshipDependency(id, relativeTo);
      if (normalized) {
        deps.add(normalized);
      }
    };

    let data = serialized.data as CardResource | undefined;
    for (let dep of this.extractDirectRelationshipDeps(
      data ?? null,
      relativeTo,
    )) {
      deps.add(dep);
    }

    for (let resource of serialized.included ?? []) {
      if (typeof resource.id === 'string') {
        addDep(resource.id);
      }
    }

    return deps;
  }

  async collectTransitiveModuleDeps(
    deps: string[],
    relativeTo: URL,
  ): Promise<Set<string>> {
    let collected = new Set<string>();
    let pending = new Set<string>();
    let visited = new Set<string>();

    for (let dep of deps) {
      let normalized = this.normalizeDependencyForLookup(dep, relativeTo);
      if (!normalized) {
        continue;
      }
      collected.add(normalized);
      if (
        !normalized.endsWith('.json') &&
        normalized.startsWith(this.#realmURL.href)
      ) {
        pending.add(normalized);
        visited.add(normalized);
      }
    }

    while (pending.size > 0) {
      let batch = [...pending];
      pending.clear();
      let entries = await this.#readModuleCacheEntries(batch);
      for (let [moduleUrl, entry] of Object.entries(entries)) {
        let base: URL;
        try {
          base = new URL(moduleUrl);
        } catch (_err) {
          base = relativeTo;
        }
        for (let dep of entry.deps ?? []) {
          let normalized = this.normalizeDependencyForLookup(dep, base);
          if (!normalized) {
            continue;
          }
          if (!collected.has(normalized)) {
            collected.add(normalized);
          }
          if (
            !normalized.endsWith('.json') &&
            normalized.startsWith(this.#realmURL.href) &&
            !visited.has(normalized)
          ) {
            visited.add(normalized);
            pending.add(normalized);
          }
        }
      }
    }

    return collected;
  }

  async collectTransitiveRelationshipDeps(
    deps: Iterable<string>,
  ): Promise<Set<string>> {
    let collected = new Set<string>();
    let pending = new Set<string>();
    let visited = new Set<string>();

    for (let dep of deps) {
      let normalized = this.normalizeStoredDependency(dep, this.#realmURL);
      collected.add(normalized);
      if (this.canTraverseRelationshipDependency(normalized)) {
        pending.add(normalized);
      }
    }

    while (pending.size > 0) {
      let batch = [...pending].filter((dep) => !visited.has(dep));
      pending.clear();
      if (batch.length === 0) {
        continue;
      }

      batch.forEach((dep) => visited.add(dep));
      let rowsByUrl = await this.getRelationshipDependencyRows(batch);

      for (let dep of batch) {
        let selected = this.selectRelationshipDependencyRow(
          dep,
          rowsByUrl.get(dep) ?? [],
        );
        if (!selected) {
          continue;
        }

        let base = new URL(dep);
        for (let nestedDep of selected.deps ?? []) {
          let normalized = this.normalizeStoredDependency(nestedDep, base);
          if (!collected.has(normalized)) {
            collected.add(normalized);
          }
          if (
            this.canTraverseRelationshipDependency(normalized) &&
            !visited.has(normalized)
          ) {
            pending.add(normalized);
          }
        }
      }
    }

    return collected;
  }

  async collectExpandedDeps({
    moduleDeps,
    relationshipResource,
    relationshipSourceResource,
    relationshipSerialized,
    relationshipSearchDoc,
    relativeTo,
  }: {
    moduleDeps: string[];
    relationshipResource: RelationshipSource;
    relationshipSourceResource?: RelationshipSource;
    relationshipSerialized?: SingleCardDocument | null;
    relationshipSearchDoc?: Record<string, unknown> | null;
    relativeTo: URL;
  }): Promise<Set<string>> {
    let relationshipDeps = new Set<string>([
      ...this.extractRenderedRelationshipDeps({
        renderedResource: relationshipResource,
        sourceResource: relationshipSourceResource ?? null,
        relativeTo,
      }),
      ...this.extractSerializedRelationshipDeps(
        relationshipSerialized,
        relativeTo,
      ),
      ...this.extractSearchDocRelationshipDeps(
        relationshipSearchDoc,
        relativeTo,
      ),
    ]);
    let [expandedModuleDeps, expandedRelationshipDeps] = await Promise.all([
      this.collectTransitiveModuleDeps(moduleDeps, relativeTo),
      this.collectTransitiveRelationshipDeps(relationshipDeps),
    ]);
    return new Set([...expandedModuleDeps, ...expandedRelationshipDeps]);
  }

  async dependencyErrorForEntry(
    deps: Iterable<string>,
    relativeTo: URL,
  ): Promise<SerializedError | undefined> {
    let depList = [...new Set(deps)];
    if (depList.length === 0) {
      return undefined;
    }
    let directErrors = await this.collectDirectRelationshipErrors(
      depList,
      relativeTo,
    );
    if (directErrors.length === 0) {
      return undefined;
    }
    let transitiveErrors = await this.collectRelationshipErrors(
      depList,
      relativeTo,
    );
    let dependencyErrors = [...directErrors, ...transitiveErrors];

    let [first, ...rest] = dependencyErrors;
    let additionalErrors = Array.isArray(first.additionalErrors)
      ? [...first.additionalErrors]
      : [];
    let seen = new Set(additionalErrors.map((error) => this.errorKey(error)));
    for (let error of rest) {
      let key = this.errorKey(error);
      if (!seen.has(key)) {
        additionalErrors.push(error);
        seen.add(key);
      }
    }

    return {
      ...first,
      deps: [...new Set([...(first.deps ?? []), ...depList])],
      additionalErrors: additionalErrors.length > 0 ? additionalErrors : null,
    };
  }

  async appendDependencyErrors<T extends SearchIndexErrorEntry>(
    entry: T,
    entryURL: URL,
  ): Promise<T> {
    let deps = entry.error.deps ?? [];
    if (deps.length === 0) {
      return entry;
    }
    let [moduleErrors, relationshipErrors] = await Promise.all([
      this.collectModuleErrors(deps, entryURL),
      this.collectRelationshipErrors(deps, entryURL),
    ]);
    let dependencyErrors = [...moduleErrors, ...relationshipErrors];
    if (dependencyErrors.length === 0) {
      return entry;
    }

    let existing = Array.isArray(entry.error.additionalErrors)
      ? [...entry.error.additionalErrors]
      : [];
    let seen = new Set(existing.map((error) => this.errorKey(error)));
    seen.add(this.errorKey(entry.error));
    let added = false;
    for (let error of dependencyErrors) {
      let key = this.errorKey(error);
      if (!seen.has(key)) {
        existing.push(error);
        seen.add(key);
        added = true;
      }
    }
    if (!added) {
      return entry;
    }
    return {
      ...entry,
      error: {
        ...entry.error,
        additionalErrors: existing,
      },
    } as T;
  }

  private normalizeDependencyForLookup(dep: string, relativeTo: URL): string {
    let canonical = canonicalURL(dep, relativeTo.href);
    try {
      return trimExecutableExtension(new URL(canonical)).href;
    } catch (_err) {
      return canonical;
    }
  }

  private normalizeRelationshipDependency(
    dep: string,
    relativeTo: URL,
  ): string {
    let canonical = canonicalURL(dep, relativeTo.href);
    try {
      let normalized = new URL(canonical);
      if (
        normalized.href.startsWith(this.#realmURL.href) &&
        this.isExtensionlessPath(normalized)
      ) {
        normalized.pathname = `${normalized.pathname}.json`;
      }
      return normalized.href;
    } catch (_err) {
      return canonical;
    }
  }

  private normalizeStoredDependency(dep: string, relativeTo: URL): string {
    return canonicalURL(dep, relativeTo.href);
  }

  private isExtensionlessPath(url: URL): boolean {
    let lastSegment = url.pathname.split('/').pop() ?? '';
    return !lastSegment.includes('.');
  }

  private canTraverseRelationshipDependency(dep: string): boolean {
    try {
      let parsed = new URL(dep);
      if (!parsed.href.startsWith(this.#realmURL.href)) {
        return false;
      }
      return !this.isExtensionlessPath(parsed);
    } catch (_err) {
      return false;
    }
  }

  private addRelationshipDependencyCandidates(
    deps: Set<string>,
    relationship: {
      links?: { self?: string | null };
      data?: unknown;
    },
    relativeTo: URL,
  ): void {
    for (let id of extractRelationshipIds(
      relationship as any,
      relativeTo.href,
    )) {
      let normalized = this.normalizeRelationshipDependency(id, relativeTo);
      if (normalized) {
        deps.add(normalized);
      }
    }
    let selfLink = relationship.links?.self;
    if (typeof selfLink === 'string' && selfLink.length > 0) {
      let normalized = this.normalizeRelationshipDependency(
        selfLink,
        relativeTo,
      );
      if (normalized) {
        deps.add(normalized);
      }
    }
  }

  private relationshipEntriesForKey(
    relationships:
      | Pick<CardResource, 'relationships'>['relationships']
      | FileMetaResource['relationships']
      | undefined,
    key: string,
  ): {
    links?: { self?: string | null };
    data?: unknown;
  }[] {
    if (!relationships) {
      return [];
    }
    let matches: {
      links?: { self?: string | null };
      data?: unknown;
    }[] = [];
    let direct = relationships[key];
    if (direct) {
      if (Array.isArray(direct)) {
        matches.push(...direct);
      } else {
        matches.push(direct);
      }
    }
    if (!/\.\d+$/.test(key)) {
      for (let [sourceKey, value] of Object.entries(relationships)) {
        if (!sourceKey.startsWith(`${key}.`)) {
          continue;
        }
        let suffix = sourceKey.slice(key.length + 1);
        if (!/^\d+$/.test(suffix)) {
          continue;
        }
        if (Array.isArray(value)) {
          matches.push(...value);
        } else {
          matches.push(value);
        }
      }
    }
    return matches;
  }

  private extractRenderedRelationshipDeps({
    renderedResource,
    sourceResource,
    relativeTo,
  }: {
    renderedResource: RelationshipSource;
    sourceResource?: RelationshipSource;
    relativeTo: URL;
  }): Set<string> {
    if (!renderedResource?.relationships) {
      return this.extractDirectRelationshipDeps(
        sourceResource ?? null,
        relativeTo,
      );
    }

    let deps = new Set<string>();
    let renderedRelationships = renderedResource.relationships;
    for (let [key, value] of Object.entries(renderedRelationships)) {
      let renderedEntries = Array.isArray(value) ? value : [value];
      for (let relationship of renderedEntries) {
        this.addRelationshipDependencyCandidates(
          deps,
          relationship,
          relativeTo,
        );
      }
      // Nested contains/field-def paths can render with null links in serialized
      // output even when source relationships are present.
      if (!key.includes('.')) {
        continue;
      }
      for (let relationship of this.relationshipEntriesForKey(
        sourceResource?.relationships,
        key,
      )) {
        this.addRelationshipDependencyCandidates(
          deps,
          relationship,
          relativeTo,
        );
      }
    }

    return deps;
  }

  private async getRelationshipDependencyRows(
    urls: string[],
  ): Promise<Map<string, DependencyIndexRow[]>> {
    let grouped = new Map<string, DependencyIndexRow[]>();
    if (urls.length === 0) {
      return grouped;
    }

    let uncached = [...new Set(urls)].filter(
      (url) => !this.#relationshipDependencyRows.has(url),
    );
    if (uncached.length > 0) {
      let rows = await this.#getDependencyRows(uncached);
      let rowsByUrl = new Map<string, DependencyIndexRow[]>();
      for (let row of rows) {
        let existing = rowsByUrl.get(row.url);
        if (existing) {
          existing.push(row);
        } else {
          rowsByUrl.set(row.url, [row]);
        }
      }

      for (let url of uncached) {
        this.#relationshipDependencyRows.set(url, rowsByUrl.get(url) ?? []);
      }
    }

    for (let url of urls) {
      grouped.set(url, this.#relationshipDependencyRows.get(url) ?? []);
    }

    return grouped;
  }

  private selectRelationshipDependencyRow(
    url: string,
    rows: DependencyIndexRow[],
  ): DependencyIndexRow | undefined {
    if (rows.length === 0) {
      return undefined;
    }
    if (url.endsWith('.json')) {
      return rows.find((row) => row.type === 'instance') ?? rows[0];
    }
    return (
      rows.find((row) => row.type === 'file') ??
      rows.find((row) => row.type === 'instance') ??
      rows[0]
    );
  }

  private errorKey(error: SerializedError): string {
    return JSON.stringify({
      id: error.id ?? null,
      message: error.message ?? null,
      status: error.status ?? null,
    });
  }

  private async getModuleErrorsFromCache(
    deps: string[],
  ): Promise<SerializedError[]> {
    if (deps.length === 0) {
      return [];
    }
    let entries = await this.#readModuleCacheEntries(deps);
    let errors: SerializedError[] = [];
    for (let entry of Object.values(entries)) {
      if (!entry.error?.error) {
        continue;
      }
      let normalized = {
        ...entry.error.error,
        additionalErrors: entry.error.error.additionalErrors ?? null,
      };
      errors.push(normalized);
    }
    return errors;
  }

  private async collectModuleErrors(
    deps: string[],
    relativeTo: URL,
  ): Promise<SerializedError[]> {
    let pending = new Set<string>();
    let visited = new Set<string>();
    let enqueue = (dep: string, base: URL) => {
      let normalized = this.normalizeDependencyForLookup(dep, base);
      if (!normalized || normalized.endsWith('.json')) {
        return;
      }
      if (visited.has(normalized)) {
        return;
      }
      visited.add(normalized);
      pending.add(normalized);
    };

    for (let dep of deps) {
      enqueue(dep, relativeTo);
    }

    let collected: SerializedError[] = [];
    let seenErrors = new Set<string>();

    while (pending.size > 0) {
      let batchDeps = [...pending];
      pending.clear();
      let errors = await this.getModuleErrorsFromCache(batchDeps);
      for (let error of errors) {
        let key = this.errorKey(error);
        if (!seenErrors.has(key)) {
          collected.push(error);
          seenErrors.add(key);
        }
        let base = relativeTo;
        if (error.id) {
          try {
            base = new URL(error.id);
          } catch (_err) {
            base = relativeTo;
          }
        }
        for (let dep of error.deps ?? []) {
          enqueue(dep, base);
        }
      }
    }

    return collected;
  }

  private async collectRelationshipErrors(
    deps: string[],
    relativeTo: URL,
  ): Promise<SerializedError[]> {
    let pending = new Set<string>();
    let visited = new Set<string>();
    let enqueue = (dep: string, base: URL) => {
      let normalized = this.normalizeStoredDependency(dep, base);
      if (!this.canTraverseRelationshipDependency(normalized)) {
        return;
      }
      if (visited.has(normalized)) {
        return;
      }
      visited.add(normalized);
      pending.add(normalized);
    };

    for (let dep of deps) {
      enqueue(dep, relativeTo);
    }

    let collected: SerializedError[] = [];
    let seenErrors = new Set<string>();
    while (pending.size > 0) {
      let batchDeps = [...pending];
      pending.clear();
      let rowsByUrl = await this.getRelationshipDependencyRows(batchDeps);

      for (let dep of batchDeps) {
        let selected = this.selectRelationshipDependencyRow(
          dep,
          rowsByUrl.get(dep) ?? [],
        );
        if (!selected) {
          continue;
        }

        if (selected.hasError && selected.errorDoc) {
          let normalized = {
            ...selected.errorDoc,
            additionalErrors: selected.errorDoc.additionalErrors ?? null,
          };
          let key = this.errorKey(normalized);
          if (!seenErrors.has(key)) {
            seenErrors.add(key);
            collected.push(normalized);
          }
        }

        for (let nestedDep of selected.deps ?? []) {
          enqueue(nestedDep, new URL(dep));
        }
      }
    }

    return collected;
  }

  private async collectDirectRelationshipErrors(
    deps: string[],
    relativeTo: URL,
  ): Promise<SerializedError[]> {
    let urls = [...new Set(deps)]
      .map((dep) => this.normalizeStoredDependency(dep, relativeTo))
      .filter((dep) => this.canTraverseRelationshipDependency(dep));
    if (urls.length === 0) {
      return [];
    }

    let rowsByUrl = await this.getRelationshipDependencyRows(urls);
    let collected: SerializedError[] = [];
    let seenErrors = new Set<string>();
    let pendingInvalidations = new Set(
      this.#getInvalidations().map((href) =>
        this.normalizeStoredDependency(href, this.#realmURL),
      ),
    );
    for (let dep of urls) {
      if (pendingInvalidations.has(dep)) {
        // This dependency is actively being reindexed in this batch; avoid
        // propagating stale error rows.
        continue;
      }
      let selected = this.selectRelationshipDependencyRow(
        dep,
        rowsByUrl.get(dep) ?? [],
      );
      if (!selected?.hasError || !selected.errorDoc) {
        continue;
      }
      let normalized = {
        ...selected.errorDoc,
        additionalErrors: selected.errorDoc.additionalErrors ?? null,
      };
      let key = this.errorKey(normalized);
      if (!seenErrors.has(key)) {
        seenErrors.add(key);
        collected.push(normalized);
      }
    }
    return collected;
  }
}
