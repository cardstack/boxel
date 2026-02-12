import { getOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { cached } from '@glimmer/tracking';

import { Resource } from 'ember-modify-based-class-resource';

import {
  ensureTrailingSlash,
  baseFileRef,
  type CardResource,
  type CodeRef,
  type FileMetaResource,
  type Saved,
} from '@cardstack/runtime-common';
import type { DataQuery } from '@cardstack/runtime-common/query';

import { getSearchData, type SearchDataResource } from './search-data';

interface Args {
  named: {
    realmURL: string;
    fileTypeFilter?: CodeRef;
  };
}

export interface FileTreeNode {
  name: string;
  path: string; // Relative path from realm root
  kind: 'file' | 'directory';
  children?: Map<string, FileTreeNode>;
}

export class FileTreeFromIndexResource extends Resource<Args> {
  // Use private field to avoid Glimmer autotracking - this prevents the error:
  // "You attempted to update `realmURL` but it had already been used previously in the same computation"
  #realmURL: string | undefined;
  #fileTypeFilter: CodeRef | undefined;
  private search: SearchDataResource | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { realmURL, fileTypeFilter } = named;
    let normalizedURL = ensureTrailingSlash(realmURL);
    this.#fileTypeFilter = fileTypeFilter;

    // Always update - the search resource handles deduplication internally
    this.#realmURL = normalizedURL;

    // Create search data resource for file-meta type in this realm
    let owner = getOwner(this) as Owner;
    this.search = getSearchData(
      this,
      owner,
      () => this.query,
      () => (this.#realmURL ? [this.#realmURL] : undefined),
      { isLive: true },
    );
  }

  private get query(): DataQuery | undefined {
    if (!this.#realmURL) {
      return undefined;
    }
    return {
      filter: {
        type: this.#fileTypeFilter ?? baseFileRef,
      },
      asData: true,
      fields: { 'file-meta': [] },
    };
  }

  get isLoading(): boolean {
    return this.search?.isLoading ?? true;
  }

  @cached
  get entries(): FileTreeNode[] {
    if (!this.search || !this.#realmURL) {
      return [];
    }

    let resources = this.search.resources;
    let tree = this.buildTreeFromResources(resources);
    return this.sortEntries(tree);
  }

  private buildTreeFromResources(
    resources: (CardResource<Saved> | FileMetaResource)[],
  ): Map<string, FileTreeNode> {
    let root = new Map<string, FileTreeNode>();

    for (let resource of resources) {
      if (!resource.id) {
        continue;
      }
      // Extract relative path from resource URL
      // The resource id is the full URL like "http://localhost:4200/myworkspace/path/to/file.txt"
      // We need just "path/to/file.txt"
      // Decode percent-encoded characters (e.g. emoji filenames appear as %F0%9F%8E%89 in URLs)
      let relativePath = decodeURIComponent(
        resource.id.replace(this.#realmURL!, ''),
      );

      // Skip if the path is empty or just the realm root
      if (!relativePath || relativePath === '/') {
        continue;
      }

      // Split path into segments: "foo/bar/baz.txt" -> ["foo", "bar", "baz.txt"]
      let segments = relativePath.split('/').filter(Boolean);

      let currentLevel = root;
      let currentPath = '';

      for (let i = 0; i < segments.length; i++) {
        let segment = segments[i];
        let isLastSegment = i === segments.length - 1;
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;

        if (!currentLevel.has(segment)) {
          currentLevel.set(segment, {
            name: segment,
            path: isLastSegment ? currentPath : `${currentPath}/`,
            kind: isLastSegment ? 'file' : 'directory',
            children: isLastSegment ? undefined : new Map(),
          });
        } else if (!isLastSegment) {
          // Ensure intermediate nodes are directories with children
          let existingNode = currentLevel.get(segment)!;
          if (!existingNode.children) {
            existingNode.children = new Map();
            existingNode.kind = 'directory';
            existingNode.path = `${currentPath}/`;
          }
        }

        if (!isLastSegment) {
          currentLevel = currentLevel.get(segment)!.children!;
        }
      }
    }

    return root;
  }

  private sortEntries(tree: Map<string, FileTreeNode>): FileTreeNode[] {
    let entries = Array.from(tree.values());

    // Sort alphabetically by name (matching the original file chooser behavior)
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Recursively sort children
    for (let entry of entries) {
      if (entry.children) {
        let sortedChildren = this.sortEntries(entry.children);
        entry.children = new Map(sortedChildren.map((e) => [e.name, e]));
      }
    }

    return entries;
  }
}

export function fileTreeFromIndex(
  parent: object,
  realmURL: () => string,
  fileTypeFilter?: () => CodeRef | undefined,
) {
  return FileTreeFromIndexResource.from(parent, () => ({
    realmURL: realmURL(),
    fileTypeFilter: fileTypeFilter?.(),
  })) as FileTreeFromIndexResource;
}
