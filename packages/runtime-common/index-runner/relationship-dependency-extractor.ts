import {
  extractRelationshipIds,
  type CardResource,
  type FileMetaResource,
  type SingleCardDocument,
} from '../index';
import { canonicalURL } from './dependency-url';
import { normalizeRelationshipDependency } from './dependency-normalization';

export type RelationshipSource =
  | Pick<CardResource, 'relationships'>
  | FileMetaResource
  | null
  | undefined;

export class RelationshipDependencyExtractor {
  #realmURL: URL;

  constructor({ realmURL }: { realmURL: URL }) {
    this.#realmURL = realmURL;
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

    let queryFieldPaths = this.queryFieldRelationshipPaths(relationships);
    for (let [key, value] of Object.entries(relationships)) {
      if (this.isQueryFieldRelationshipKey(key, queryFieldPaths)) {
        continue;
      }
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
    queryFieldPaths?: Set<string>,
  ): Set<string> {
    let deps = new Set<string>();
    if (!searchDoc) {
      return deps;
    }

    let selfUrls = new Set<string>();
    let canonicalSelf = canonicalURL(relativeTo.href, relativeTo.href);
    selfUrls.add(canonicalSelf);
    selfUrls.add(
      normalizeRelationshipDependency(
        canonicalSelf,
        relativeTo,
        this.#realmURL,
      ),
    );
    if (canonicalSelf.endsWith('.json')) {
      selfUrls.add(canonicalSelf.replace(/\.json$/, ''));
    } else {
      selfUrls.add(`${canonicalSelf}.json`);
    }

    let visited = new Set<unknown>();
    let visit = (value: unknown, path: string[] = []) => {
      if (value == null || typeof value !== 'object') {
        return;
      }
      if (visited.has(value)) {
        return;
      }
      visited.add(value);

      if (Array.isArray(value)) {
        for (let item of value) {
          visit(item, path);
        }
        return;
      }

      let maybeId = (value as { id?: unknown }).id;
      if (typeof maybeId === 'string') {
        let normalized = normalizeRelationshipDependency(
          maybeId,
          relativeTo,
          this.#realmURL,
        );
        if (normalized && !selfUrls.has(normalized)) {
          deps.add(normalized);
        }
      }

      for (let [key, nested] of Object.entries(
        value as Record<string, unknown>,
      )) {
        let nextPath = [...path, key];
        if (this.isQueryFieldSearchDocPath(nextPath, queryFieldPaths)) {
          continue;
        }
        visit(nested, nextPath);
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

    let data = serialized.data as CardResource | undefined;
    for (let dep of this.extractDirectRelationshipDeps(
      data ?? null,
      relativeTo,
    )) {
      deps.add(dep);
    }
    // Intentionally do not derive deps from `included` resources. We only track
    // relationship edges from the consuming resource itself so query-backed
    // relationships (which can seed included records) do not become deps.
    return deps;
  }

  extractQueryFieldRelationshipPaths(
    ...resources: RelationshipSource[]
  ): Set<string> {
    let paths = new Set<string>();
    for (let resource of resources) {
      let relationships = resource?.relationships;
      if (!relationships) {
        continue;
      }
      for (let fieldPath of this.queryFieldRelationshipPaths(relationships)) {
        paths.add(fieldPath);
      }
    }
    return paths;
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
      let normalized = normalizeRelationshipDependency(
        id,
        relativeTo,
        this.#realmURL,
      );
      if (normalized) {
        deps.add(normalized);
      }
    }
    let selfLink = relationship.links?.self;
    if (typeof selfLink === 'string' && selfLink.length > 0) {
      let normalized = normalizeRelationshipDependency(
        selfLink,
        relativeTo,
        this.#realmURL,
      );
      if (normalized) {
        deps.add(normalized);
      }
    }
  }

  private queryFieldRelationshipPaths(
    relationships:
      | Pick<CardResource, 'relationships'>['relationships']
      | FileMetaResource['relationships']
      | undefined,
  ): Set<string> {
    let paths = new Set<string>();
    if (!relationships) {
      return paths;
    }
    for (let [key, value] of Object.entries(relationships)) {
      if (Array.isArray(value) || /\.\d+$/.test(key)) {
        continue;
      }
      if (typeof value?.links?.search === 'string' && value.links.search) {
        paths.add(key);
      }
    }
    return paths;
  }

  private isQueryFieldRelationshipKey(
    key: string,
    queryFieldPaths: Set<string>,
  ): boolean {
    for (let queryFieldPath of queryFieldPaths) {
      if (key === queryFieldPath || key.startsWith(`${queryFieldPath}.`)) {
        return true;
      }
    }
    return false;
  }

  private isQueryFieldSearchDocPath(
    path: string[],
    queryFieldPaths?: Set<string>,
  ): boolean {
    if (!queryFieldPaths || queryFieldPaths.size === 0 || path.length === 0) {
      return false;
    }
    let joined = path.join('.');
    for (let queryFieldPath of queryFieldPaths) {
      if (
        joined === queryFieldPath ||
        joined.startsWith(`${queryFieldPath}.`)
      ) {
        return true;
      }
    }
    return false;
  }
}
