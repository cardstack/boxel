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
  // The realm whose files the last completed search loaded — read by
  // `isInitialLoading` to tell a first load (nothing to show yet) from a
  // refresh (stale entries stay up while the new result lands). Untracked on
  // purpose: consumers recompute off the task's `isRunning` flip.
  #loadedRealm: string | undefined;
  // @ts-ignore we use this.loaded for test instrumentation.
  private loaded: Promise<void> | undefined;
  private _files = new TrackedArray<IndexedFileRow>();
  // Relative dir paths (trailing slash) discovered via DirectoryListing —
  // includes empty directories the index can't yield. Empty unless
  // `discoverEmptyDirs` is set. Tagged with the realm the crawl ran against so
  // `entries` never merges one realm's dirs into another realm's tree while a
  // post-switch crawl is still in flight. Reassigned wholesale so `entries`
  // recomputes.
  @tracked private discoveredDirs: { realmURL: string; paths: string[] } = {
    realmURL: '',
    paths: [],
  };

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
    // Guarded so `modify` (which runs during render) only writes the tracked
    // state when it actually changes — an unconditional write risks a
    // backtracking assertion against a consumer that read `entries` earlier
    // in the same render.
    if (!this.#discoverEmptyDirs && this.discoveredDirs.paths.length) {
      this.discoveredDirs = { realmURL: '', paths: [] };
    }
  }

  // The file search re-runs on incremental `index` events (a created/deleted
  // card indexes and its file row appears/disappears) and chains a directory
  // re-crawl so the dir set is always re-validated against fresh files.
  // Directory discovery additionally re-runs on `update` events that add or
  // remove files — dir structure is filesystem-immediate, and an out-of-band
  // dir removal may fire no index event at all. An `updated`-only event (a
  // source save while editing) touches neither and is ignored.
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

  // True only while there is nothing to show yet for the current realm — the
  // first search since mount or since a realm switch. Refreshes (index events,
  // the dir crawl) keep the existing entries up while the new result lands, so
  // consumers should mask on this rather than `isLoading`.
  get isInitialLoading(): boolean {
    return this.search.isRunning && this.#loadedRealm !== this.#realmURL;
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
      this.#loadedRealm = realmURL;
    } finally {
      waiter.endAsync(token);
    }
    // Re-validate the directory set against the fresh file list — this is what
    // eventually drops a wholesale-deleted directory (the `update`-event crawl
    // may have run against stale files).
    if (this.#discoverEmptyDirs) {
      this.discoverDirs.perform();
    }
  });

  private discoverDirs = restartableTask(async () => {
    let realmURL = this.#realmURL;
    if (!realmURL || !this.#discoverEmptyDirs) {
      return;
    }
    let token = waiter.beginAsync();
    try {
      // Seed the crawl frontier with the non-empty dirs the index already
      // yields (ancestors of every indexed file) so the whole known structure
      // lists in one parallel wave; only empty subtrees need further waves.
      // Seeds are frontier hints, not results — a stale seed drops out.
      let known = new Set<string>();
      for (let { url } of this._files) {
        for (let dir of ancestorDirs(this.relativePath(url))) {
          known.add(dir);
        }
      }
      let paths = await this.crawlDirs(known, realmURL);
      this.discoveredDirs = { realmURL, paths };
    } finally {
      waiter.endAsync(token);
    }
  });

  // BFS from the realm root + every known dir, listing each directory's child
  // directories. A child not already enqueued is an empty-subtree root —
  // enqueue it so we descend into it (and only it: every known branch is
  // already covered). Terminates within the depth of the deepest empty chain,
  // since listing an empty dir only ever finds more empty dirs.
  //
  // Returns only dirs *observed as a child in a listing response* — never the
  // seeds themselves. Every dir on disk is observed via its listed parent
  // (`known` carries full ancestor chains up to the listed root), while a
  // stale seed (a dir deleted wholesale but still present in the file list the
  // seeds came from) is never observed and so drops out.
  private async crawlDirs(
    known: Set<string>,
    realmURL: string,
  ): Promise<string[]> {
    let observed = new Set<string>();
    let enqueued = new Set(['', ...known]);
    let frontier = [...enqueued];
    while (frontier.length) {
      let childLists = await mapWithConcurrency(
        frontier,
        DIR_CRAWL_CONCURRENCY,
        (dir) => this.listChildDirs(dir, realmURL),
      );
      let next: string[] = [];
      for (let children of childLists) {
        for (let child of children) {
          observed.add(child);
          if (!enqueued.has(child)) {
            enqueued.add(child);
            next.push(child);
          }
        }
      }
      frontier = next;
    }
    return [...observed];
  }

  // One DirectoryListing → this dir's immediate child dirs (relative, trailing
  // slash). Boot-tolerant like the old DirectoryResource: a failed fetch or a
  // malformed body yields no children rather than failing the crawl.
  private async listChildDirs(
    dir: string,
    realmURL: string,
  ): Promise<string[]> {
    try {
      let response = await this.network.authedFetch(new URL(dir, realmURL), {
        headers: { Accept: SupportedMimeType.DirectoryListing },
      });
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
    } catch (e) {
      log.error(`directory listing failed for ${dir}: ${e}`);
      return [];
    }
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
    let { realmURL, paths } = this.discoveredDirs;
    let dirPaths = realmURL === this.#realmURL ? paths : [];
    let tree = this.buildTree(this._files, dirPaths);
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
