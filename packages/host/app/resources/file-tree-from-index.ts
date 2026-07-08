import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { isEqual } from 'lodash-es';
import { TrackedArray } from 'tracked-built-ins';

import {
  ensureTrailingSlash,
  subscribeToRealm,
  baseFileRef,
  type CodeRef,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type StoreService from '../services/store';

const waiter = buildWaiter('file-tree-from-index-resource:search-waiter');

interface Args {
  named: {
    realmURL: string;
    fileTypeFilter?: CodeRef;
    // Optional equality constraints on indexed file fields (e.g.
    // `{ kind: 'skill' }`), narrowing the tree beyond the type anchor.
    fileFieldFilter?: Record<string, unknown>;
  };
}

export interface FileTreeNode {
  name: string;
  path: string; // Relative path from realm root
  kind: 'file' | 'directory';
  children?: Map<string, FileTreeNode>;
}

export class FileTreeFromIndexResource extends Resource<Args> {
  @service declare private store: StoreService;

  // Use private fields to avoid Glimmer autotracking - this prevents the error:
  // "You attempted to update `realmURL` but it had already been used previously in the same computation"
  #realmURL: string | undefined;
  #fileTypeFilter: CodeRef | undefined;
  #fileFieldFilter: Record<string, unknown> | undefined;
  #subscription: { realmURL: string; unsubscribe: () => void } | undefined;
  // @ts-ignore we use this.loaded for test instrumentation.
  private loaded: Promise<void> | undefined;
  private _fileURLs = new TrackedArray<string>();

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      this.#subscription?.unsubscribe();
    });
  }

  modify(_positional: never[], named: Args['named']) {
    let { realmURL, fileTypeFilter, fileFieldFilter } = named;
    let normalizedURL = ensureTrailingSlash(realmURL);
    let unchanged =
      this.#realmURL === normalizedURL &&
      isEqual(this.#fileTypeFilter, fileTypeFilter) &&
      isEqual(this.#fileFieldFilter, fileFieldFilter);
    this.#fileTypeFilter = fileTypeFilter;
    this.#fileFieldFilter = fileFieldFilter;
    this.#realmURL = normalizedURL;

    if (this.#subscription?.realmURL !== normalizedURL) {
      this.#subscription?.unsubscribe();
      this.#subscription = {
        realmURL: normalizedURL,
        unsubscribe: subscribeToRealm(
          normalizedURL,
          (event: RealmEventContent) => {
            if (
              event.eventName !== 'index' ||
              ('indexType' in event && event.indexType !== 'incremental')
            ) {
              return;
            }
            this.search.perform();
          },
        ),
      };
    }

    if (unchanged) {
      return;
    }
    this.loaded = this.search.perform();
  }

  get isLoading(): boolean {
    return this.search.isRunning;
  }

  private search = restartableTask(async () => {
    let realmURL = this.#realmURL;
    if (!realmURL) {
      return;
    }
    let token = waiter.beginAsync();
    try {
      let { data } = await this.store.searchEntries(this.query, [realmURL]);
      let fileURLs = data.map((entry) => entry.id).filter(Boolean);
      this._fileURLs.splice(0, this._fileURLs.length, ...fileURLs);
    } finally {
      waiter.endAsync(token);
    }
  });

  // The file tree only needs each matched file's URL — the `entry`
  // ids. The fieldset pins the leanest projection the wire grammar offers (a
  // single-field sparse item) rather than full serializations or renderings.
  private get query(): SearchEntryWireQuery {
    let fieldFilter = this.#fileFieldFilter;
    let eq =
      fieldFilter && Object.keys(fieldFilter).length > 0
        ? Object.fromEntries(
            // Field paths in the entry wire grammar are `item.`-prefixed.
            Object.entries(fieldFilter).map(([field, value]) => [
              `item.${field}`,
              value,
            ]),
          )
        : undefined;
    return {
      filter: {
        'item.on': this.#fileTypeFilter ?? baseFileRef,
        ...(eq ? { eq } : {}),
      },
      fields: { entry: ['item.name'] },
    };
  }

  @cached
  get entries(): FileTreeNode[] {
    if (!this.#realmURL) {
      return [];
    }

    let tree = this.buildTreeFromFileURLs(this._fileURLs);
    return this.sortEntries(tree);
  }

  private buildTreeFromFileURLs(fileURLs: string[]): Map<string, FileTreeNode> {
    let root = new Map<string, FileTreeNode>();

    for (let fileURL of fileURLs) {
      // Extract relative path from the file URL
      // The entry id is the full URL like "http://localhost:4200/myworkspace/path/to/file.txt"
      // We need just "path/to/file.txt"
      // Decode percent-encoded characters (e.g. emoji filenames appear as %F0%9F%8E%89 in URLs)
      let relativePath = decodeURIComponent(
        fileURL.replace(this.#realmURL!, ''),
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
  fileFieldFilter?: () => Record<string, unknown> | undefined,
) {
  return FileTreeFromIndexResource.from(parent, () => ({
    realmURL: realmURL(),
    fileTypeFilter: fileTypeFilter?.(),
    fileFieldFilter: fileFieldFilter?.(),
  })) as FileTreeFromIndexResource;
}
