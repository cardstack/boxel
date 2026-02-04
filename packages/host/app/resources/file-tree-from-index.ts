import { getOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { tracked, cached } from '@glimmer/tracking';

import { Resource } from 'ember-modify-based-class-resource';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import { getSearch, type SearchResource } from './search';

interface Args {
  named: {
    realmURL: string;
  };
}

export interface FileTreeNode {
  name: string;
  path: string; // Relative path from realm root
  kind: 'file' | 'directory';
  children?: Map<string, FileTreeNode>;
}

export class FileTreeFromIndexResource extends Resource<Args> {
  @tracked private realmURL: string | undefined;
  private search: SearchResource<FileDef> | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { realmURL } = named;
    let normalizedURL = ensureTrailingSlash(realmURL);

    if (this.realmURL === normalizedURL) {
      return;
    }

    this.realmURL = normalizedURL;

    // Create search resource for FileDef type in this realm
    let owner = getOwner(this) as Owner;
    this.search = getSearch<FileDef>(
      this,
      owner,
      () => this.query,
      () => (this.realmURL ? [this.realmURL] : undefined),
      { isLive: true },
    );
  }

  private get query(): Query | undefined {
    if (!this.realmURL) {
      return undefined;
    }
    return {
      filter: {
        type: {
          module: 'https://cardstack.com/base/file-api',
          name: 'FileDef',
        },
      },
    };
  }

  get isLoading(): boolean {
    return this.search?.isLoading ?? true;
  }

  @cached
  get entries(): FileTreeNode[] {
    if (!this.search || !this.realmURL) {
      return [];
    }

    let files = this.search.instances;
    let tree = this.buildTreeFromFiles(files);
    return this.sortEntries(tree);
  }

  private buildTreeFromFiles(files: FileDef[]): Map<string, FileTreeNode> {
    let root = new Map<string, FileTreeNode>();

    for (let file of files) {
      // Extract relative path from file URL
      // The file id is the full URL like "http://localhost:4200/myworkspace/path/to/file.txt"
      // We need just "path/to/file.txt"
      let relativePath = file.id.replace(this.realmURL!, '');

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

    // Sort: directories first, then alphabetically by name
    entries.sort((a, b) => {
      // Directories come before files
      if (a.kind === 'directory' && b.kind === 'file') {
        return -1;
      }
      if (a.kind === 'file' && b.kind === 'directory') {
        return 1;
      }
      // Within same kind, sort alphabetically
      return a.name.localeCompare(b.name);
    });

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

export function fileTreeFromIndex(parent: object, realmURL: () => string) {
  return FileTreeFromIndexResource.from(parent, () => ({
    realmURL: realmURL(),
  })) as FileTreeFromIndexResource;
}
