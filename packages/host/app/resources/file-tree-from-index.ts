import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { cached, tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { isEqual } from 'lodash-es';
import { TrackedArray } from 'tracked-built-ins';

import {
  ensureTrailingSlash,
  logger,
  subscribeToRealm,
  baseFileRef,
  SupportedMimeType,
  type CodeRef,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import type NetworkService from '../services/network';
import type StoreService from '../services/store';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

const log = logger('resource:file-tree-from-index');
const waiter = buildWaiter('file-tree-from-index-resource:search-waiter');

// Cap on concurrent DirectoryListing fetches during empty-directory discovery
// so a large realm doesn't fan out a thundering herd on every code-submode open.
const DIR_CRAWL_CONCURRENCY = 10;

interface Args {
  named: {
    realmURL: string;
    fileTypeFilter?: CodeRef;
    // Optional equality constraints on indexed file fields (e.g.
    // `{ kind: 'skill' }`), narrowing the tree beyond the type anchor.
    fileFieldFilter?: Record<string, unknown>;
    // Surface error rows (files that failed to index) so they stay visible to
    // be fixed. Off by default (the file chooser stays healthy-only); the
    // code-submode tree turns it on.
    includeErrors?: boolean;
    // Discover empty directories the index can't see (folders whose entire
    // subtree holds zero indexed files — deletion residue). Off by default
    // (the file chooser skips the realm-wide DirectoryListing crawl); the
    // code-submode tree turns it on.
    discoverEmptyDirs?: boolean;
  };
}

export interface FileTreeNode {
  name: string;
  path: string; // Relative path from realm root
  kind: 'file' | 'directory';
  children?: Map<string, FileTreeNode>;
  // True for a file that failed to index (only ever set when the resource is
  // queried with `includeErrors`).
  hasError?: boolean;
}

interface IndexedFileRow {
  url: string;
  hasError: boolean;
}

export class FileTreeFromIndexResource extends Resource<Args> {
  @service declare private store: StoreService;
  @service declare private network: NetworkService;

  // Use private fields to avoid Glimmer autotracking - this prevents the error:
  // "You attempted to update `realmURL` but it had already been used previously in the same computation"
  #realmURL: string | undefined;
  #fileTypeFilter: CodeRef | undefined;
  #fileFieldFilter: Record<string, unknown> | undefined;
  #includeErrors = false;
  #discoverEmptyDirs = false;
  #subscription: { realmURL: string; unsubscribe: () => void } | undefined;
  // @ts-ignore we use this.loaded for test instrumentation.
  private loaded: Promise<void> | undefined;
  private _files = new TrackedArray<IndexedFileRow>();
  // Relative dir paths (trailing slash) discovered via DirectoryListing —
  // includes empty directories the index can't yield. Empty unless
  // `discoverEmptyDirs` is set. Reassigned wholesale so `entries` recomputes.
  @tracked private discoveredDirPaths: string[] = [];

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      this.#subscription?.unsubscribe();
    });
  }

  modify(_positional: never[], named: Args['named']) {
    let { realmURL, fileTypeFilter, fileFieldFilter, includeErrors } = named;
    let discoverEmptyDirs = Boolean(named.discoverEmptyDirs);
    let normalizedURL = ensureTrailingSlash(realmURL);
    let unchanged =
      this.#realmURL === normalizedURL &&
      isEqual(this.#fileTypeFilter, fileTypeFilter) &&
      isEqual(this.#fileFieldFilter, fileFieldFilter) &&
      this.#includeErrors === Boolean(includeErrors) &&
      this.#discoverEmptyDirs === discoverEmptyDirs;
    this.#fileTypeFilter = fileTypeFilter;
    this.#fileFieldFilter = fileFieldFilter;
    this.#includeErrors = Boolean(includeErrors);
    this.#discoverEmptyDirs = discoverEmptyDirs;
    this.#realmURL = normalizedURL;

    if (this.#subscription?.realmURL !== normalizedURL) {
      this.#subscription?.unsubscribe();
      this.#subscription = {
        realmURL: normalizedURL,
        unsubscribe: subscribeToRealm(
          normalizedURL,
          (event: RealmEventContent) => this.handleRealmEvent(event),
        ),
      };
    }

    if (unchanged) {
      return;
    }
    this.loaded = this.search.perform();
    if (this.#discoverEmptyDirs) {
      this.discoverDirs.perform();
    } else {
      this.discoveredDirPaths = [];
    }
  }

  // The file search re-runs on incremental `index` events (a created/deleted
  // card indexes and its file row appears/disappears). Directory discovery
  // re-runs on `update` events that add or remove files — those are the only
  // signal for an emptied directory (a deleted last file leaves the folder on
  // disk, which the index can't see). An `updated`-only event (a source save
  // while editing) touches neither and is ignored.
  private handleRealmEvent(event: RealmEventContent) {
    if (
      event.eventName === 'index' &&
      (!('indexType' in event) || event.indexType === 'incremental')
    ) {
      this.search.perform();
      return;
    }
    if (
      this.#discoverEmptyDirs &&
      event.eventName === 'update' &&
      (('added' in event && event.added) ||
        ('removed' in event && event.removed))
    ) {
      this.discoverDirs.perform();
    }
  }

  get isLoading(): boolean {
    return this.search.isRunning || this.discoverDirs.isRunning;
  }

  private search = restartableTask(async () => {
    let realmURL = this.#realmURL;
    if (!realmURL) {
      return;
    }
    let token = waiter.beginAsync();
    try {
      let { data } = await this.store.searchEntries(this.query, [realmURL]);
      let files = data
        .filter((entry) => entry.id)
        .map((entry) => ({
          url: entry.id,
          hasError: Boolean(entry.meta?.hasError),
        }));
      this._files.splice(0, this._files.length, ...files);
    } finally {
      waiter.endAsync(token);
    }
  });

  private discoverDirs = restartableTask(async () => {
    let realmURL = this.#realmURL;
    if (!realmURL || !this.#discoverEmptyDirs) {
      return;
    }
    let token = waiter.beginAsync();
    try {
      // Seed with the non-empty dirs the index already yields (ancestors of
      // every indexed file). The crawl then only additionally surfaces the
      // empty subtrees.
      let known = new Set<string>();
      for (let { url } of this._files) {
        for (let dir of ancestorDirs(this.relativePath(url))) {
          known.add(dir);
        }
      }
      this.discoveredDirPaths = await this.crawlDirs(known, realmURL);
    } finally {
      waiter.endAsync(token);
    }
  });

  // BFS from the realm root + every known dir, listing each directory's child
  // directories. A child not already known is an empty-subtree root — enqueue
  // it so we descend into it (and only it: every known branch is already
  // covered). Terminates within the depth of the deepest empty chain, since
  // listing an empty dir only ever finds more empty dirs.
  private async crawlDirs(
    known: Set<string>,
    realmURL: string,
  ): Promise<string[]> {
    let all = new Set(known);
    let frontier = ['', ...known];
    while (frontier.length) {
      let childLists = await mapWithConcurrency(
        frontier,
        DIR_CRAWL_CONCURRENCY,
        (dir) => this.listChildDirs(dir, realmURL),
      );
      let next: string[] = [];
      for (let children of childLists) {
        for (let child of children) {
          if (!all.has(child)) {
            all.add(child);
            next.push(child);
          }
        }
      }
      frontier = next;
    }
    all.delete(''); // the realm root is not a tree node
    return [...all];
  }

  // One DirectoryListing → this dir's immediate child dirs (relative, trailing
  // slash). Boot-tolerant like DirectoryResource: a failed fetch yields no
  // children rather than throwing.
  private async listChildDirs(
    dir: string,
    realmURL: string,
  ): Promise<string[]> {
    let response: Response;
    try {
      response = await this.network.authedFetch(new URL(dir, realmURL), {
        headers: { Accept: SupportedMimeType.DirectoryListing },
      });
    } catch (e) {
      log.error(`directory listing fetch failed for ${dir}: ${e}`);
      return [];
    }
    if (!response.ok) {
      return [];
    }
    let json = await response.json();
    let relationships = (json?.data?.relationships ?? {}) as Record<
      string,
      { meta?: { kind?: string } }
    >;
    // The relationship key already carries a trailing '/' for directories
    // (realm.ts getDirectoryListing), so `${dir}${name}` is the child's
    // relative dir path.
    return Object.entries(relationships)
      .filter(([, info]) => info?.meta?.kind === 'directory')
      .map(([name]) => `${dir}${name}`);
  }

  // The file tree only needs each matched file's URL (the `entry` id) plus its
  // error flag (`entry.meta.hasError`). The fieldset pins the leanest
  // projection the wire grammar offers (a single-field sparse item) rather than
  // full serializations or renderings. `scope: 'files'` restricts to file rows
  // — required so `includeErrors` is honored (the mixed `all` scope always
  // forces its file branch healthy).
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
      scope: 'files',
      ...(this.#includeErrors ? { includeErrors: true } : {}),
    };
  }

  private relativePath(fileURL: string): string {
    // The entry id is the full URL like
    // "http://localhost:4200/myworkspace/path/to/file.txt"; strip the realm
    // prefix down to "path/to/file.txt". Decode percent-encoded characters
    // (e.g. emoji filenames appear as %F0%9F%8E%89 in URLs).
    return decodeURIComponent(fileURL.replace(this.#realmURL!, ''));
  }

  @cached
  get entries(): FileTreeNode[] {
    if (!this.#realmURL) {
      return [];
    }
    let tree = this.buildTree(this._files, this.discoveredDirPaths);
    return this.sortEntries(tree);
  }

  private buildTree(
    files: readonly IndexedFileRow[],
    dirPaths: readonly string[],
  ): Map<string, FileTreeNode> {
    let root = new Map<string, FileTreeNode>();

    // Seed discovered directories first (each dir path materializes its
    // intermediate nodes), then overlay the index files. The merge is
    // order-independent and deduped by path: a dir with files comes from both
    // (deduped), an empty dir only from the crawl, a file only from the index.
    for (let dirPath of dirPaths) {
      this.ensureDir(root, dirPath);
    }
    for (let { url, hasError } of files) {
      this.addFile(root, this.relativePath(url), hasError);
    }

    return root;
  }

  // Walk `segments` from `root`, creating/normalizing intermediate directory
  // nodes, and return the deepest level's children map (where a leaf belongs).
  // `stopBefore` leaves the final segment for the caller (a file leaf).
  private descendDirs(
    root: Map<string, FileTreeNode>,
    segments: string[],
    stopBefore: number,
  ): Map<string, FileTreeNode> {
    let currentLevel = root;
    let currentPath = '';
    for (let i = 0; i < stopBefore; i++) {
      let segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = currentLevel.get(segment);
      if (!node) {
        node = {
          name: segment,
          path: `${currentPath}/`,
          kind: 'directory',
          children: new Map(),
        };
        currentLevel.set(segment, node);
      } else if (!node.children) {
        // Normalize a node previously seen as a leaf into a directory.
        node.children = new Map();
        node.kind = 'directory';
        node.path = `${currentPath}/`;
      }
      currentLevel = node.children!;
    }
    return currentLevel;
  }

  private ensureDir(root: Map<string, FileTreeNode>, dirPath: string) {
    let segments = dirPath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return;
    }
    this.descendDirs(root, segments, segments.length);
  }

  private addFile(
    root: Map<string, FileTreeNode>,
    relativePath: string,
    hasError: boolean,
  ) {
    // Skip if the path is empty or just the realm root
    if (!relativePath || relativePath === '/') {
      return;
    }
    let segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return;
    }
    let parentLevel = this.descendDirs(root, segments, segments.length - 1);
    let fileName = segments[segments.length - 1];
    let existing = parentLevel.get(fileName);
    // Don't clobber a directory node that already exists at this path.
    if (existing && existing.children) {
      return;
    }
    parentLevel.set(fileName, {
      name: fileName,
      path: relativePath,
      kind: 'file',
      ...(hasError ? { hasError: true } : {}),
    });
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

// All ancestor directory paths of a relative file path, trailing slash. E.g.
// "a/b/c.json" -> ["a/", "a/b/"].
function ancestorDirs(relativePath: string): string[] {
  let segments = relativePath.split('/').filter(Boolean);
  let dirs: string[] = [];
  let acc = '';
  for (let i = 0; i < segments.length - 1; i++) {
    acc = acc ? `${acc}/${segments[i]}` : segments[i];
    dirs.push(`${acc}/`);
  }
  return dirs;
}

// Run `fn` over `items` with at most `limit` in flight, preserving order.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  let results: R[] = new Array(items.length);
  let cursor = 0;
  let worker = async () => {
    let i = cursor++;
    while (i < items.length) {
      results[i] = await fn(items[i]);
      i = cursor++;
    }
  };
  let workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function fileTreeFromIndex(
  parent: object,
  realmURL: () => string,
  fileTypeFilter?: () => CodeRef | undefined,
  fileFieldFilter?: () => Record<string, unknown> | undefined,
  includeErrors?: () => boolean | undefined,
  discoverEmptyDirs?: () => boolean | undefined,
) {
  return FileTreeFromIndexResource.from(parent, () => ({
    realmURL: realmURL(),
    fileTypeFilter: fileTypeFilter?.(),
    fileFieldFilter: fileFieldFilter?.(),
    includeErrors: includeErrors?.(),
    discoverEmptyDirs: discoverEmptyDirs?.(),
  })) as FileTreeFromIndexResource;
}
