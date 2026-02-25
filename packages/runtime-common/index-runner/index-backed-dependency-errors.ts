import type { DependencyIndexRow, SearchIndexErrorEntry } from '../index';
import type { ModuleCacheEntries } from '../definition-lookup';
import type { SerializedError } from '../error';
import { canonicalURL } from './dependency-url';
import {
  canTraverseRelationshipDependency,
  normalizeDependencyForLookup,
  normalizeStoredDependency,
} from './dependency-normalization';

interface IndexBackedDependencyErrorOptions {
  realmURL: URL;
  readModuleCacheEntries(moduleIds: string[]): Promise<ModuleCacheEntries>;
  getDependencyRows(urls: string[]): Promise<DependencyIndexRow[]>;
  getInvalidations(): string[];
}

export class IndexBackedDependencyErrors {
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
  }: IndexBackedDependencyErrorOptions) {
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

  async indexBackedDependencyErrorForEntry(
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

  async appendIndexBackedDependencyErrors<T extends SearchIndexErrorEntry>(
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
      let normalized = normalizeDependencyForLookup(dep, base);
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
      let normalized = normalizeStoredDependency(dep, base);
      if (!canTraverseRelationshipDependency(normalized, this.#realmURL)) {
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
      .map((dep) => normalizeStoredDependency(dep, relativeTo))
      .filter((dep) => canTraverseRelationshipDependency(dep, this.#realmURL));
    if (urls.length === 0) {
      return [];
    }

    let rowsByUrl = await this.getRelationshipDependencyRows(urls);
    let collected: SerializedError[] = [];
    let seenErrors = new Set<string>();
    let pendingInvalidations = new Set(
      this.#getInvalidations().map((href) =>
        normalizeStoredDependency(href, this.#realmURL),
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
