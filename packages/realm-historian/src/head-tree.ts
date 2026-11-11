// The tree of a realm's HEAD, held in memory, so a commit writes only the
// trees of the directories its changed paths are in rather than every tree
// in the realm.
//
// It is loaded once from the repo with `git ls-tree -r -t`, and each commit
// derives the next snapshot from it with `apply`, which leaves the snapshot it
// was called on as it was: the recorder swaps its cached tree for the new one
// only once HEAD has moved to the commit that uses it.
//
// A file is a blob entry. A size-only entry is a tree holding one marker
// blob, and stands for its file: it is a file here, not a directory, and its
// marker is never a path of its own.

import {
  BLOB_MODE,
  TREE_MODE,
  hashObject,
  type ObjectStore,
  type TreeEntry,
} from './git-objects.ts';
import { runGit, SIZE_ONLY_MARKER_NAME } from './repo-format.ts';

// The tree with no entries, which a revision of a realm with no files uses.
export const EMPTY_TREE_ID = hashObject('tree', new Uint8Array());

export interface FileEntry {
  mode: TreeEntry['mode'];
  // A blob id, or a size-only entry's tree id.
  id: string;
}

interface Directory {
  // The tree id, or '' for a directory `apply` has created and not written.
  id: string;
  entries: Map<string, TreeEntry>;
}

export class HeadTree {
  // Every file, by path.
  #files: Map<string, FileEntry>;
  // Every directory, by path, with '' for the root.
  #directories: Map<string, Directory>;
  // The marker blob of each size-only entry loaded from the repo, by path.
  #markers: Map<string, string>;

  private constructor(
    files: Map<string, FileEntry>,
    directories: Map<string, Directory>,
    markers: Map<string, string>,
  ) {
    this.#files = files;
    this.#directories = directories;
    this.#markers = markers;
  }

  static empty(): HeadTree {
    return new HeadTree(
      new Map(),
      new Map([['', { id: EMPTY_TREE_ID, entries: new Map() }]]),
      new Map(),
    );
  }

  static async load(gitDir: string, commit: string): Promise<HeadTree> {
    let root = (await runGit(gitDir, ['rev-parse', `${commit}^{tree}`]))
      .toString('utf8')
      .trim();
    let listing = (
      await runGit(gitDir, ['ls-tree', '-r', '-t', '-z', '--full-tree', commit])
    ).toString('utf8');
    let directories = new Map<string, Directory>([
      ['', { id: root, entries: new Map() }],
    ]);
    let blobs = new Map<string, FileEntry>();
    for (let record of listing.split('\0')) {
      if (record === '') {
        continue;
      }
      // `<mode> <type> <id>\t<path>`
      let tab = record.indexOf('\t');
      let [mode, type, id] = record.slice(0, tab).split(' ');
      let path = record.slice(tab + 1);
      let { directory, name } = splitPath(path);
      let isTree = type === 'tree';
      let entryMode = (isTree ? TREE_MODE : mode) as TreeEntry['mode'];
      if (isTree) {
        directories.set(path, { id, entries: new Map() });
      } else {
        blobs.set(path, { mode: entryMode, id });
      }
      directoryOf(directories, directory).entries.set(name, {
        mode: entryMode,
        name,
        id,
      });
    }
    let files = new Map<string, FileEntry>();
    let markers = new Map<string, string>();
    for (let [path, directory] of directories) {
      let marker = sizeOnlyMarkerOf(directory);
      if (path !== '' && marker) {
        directories.delete(path);
        blobs.delete(`${path}/${SIZE_ONLY_MARKER_NAME}`);
        files.set(path, { mode: TREE_MODE, id: directory.id });
        markers.set(path, marker);
      }
    }
    for (let [path, entry] of blobs) {
      files.set(path, entry);
    }
    return new HeadTree(files, directories, markers);
  }

  // The root tree's id.
  get root(): string {
    return this.#directories.get('')!.id;
  }

  get files(): ReadonlyMap<string, FileEntry> {
    return this.#files;
  }

  entry(path: string): FileEntry | undefined {
    return this.#files.get(path);
  }

  // The marker blob of a size-only entry loaded from the repo.
  marker(path: string): string | undefined {
    return this.#markers.get(path);
  }

  // The snapshot with `changes` applied: a path mapped to an entry is set to
  // it, and a path mapped to null is removed. Writes every tree that differs
  // from this snapshot's, and leaves this snapshot as it was. Removals go
  // first, so a file can take the name of a directory the same changes
  // empty, and a directory left with no entries is removed from its parent.
  // A path that would make one name both a file and a directory is refused.
  async apply(
    store: ObjectStore,
    changes: ReadonlyMap<string, FileEntry | null>,
  ): Promise<HeadTree> {
    let files = new Map(this.#files);
    let markers = new Map(this.#markers);
    let directories = new Map(this.#directories);
    let copied = new Set<string>();
    let touched = new Set<string>();
    let writable = (path: string): Directory => {
      let directory = directories.get(path);
      if (!directory || !copied.has(path)) {
        directory = {
          id: directory?.id ?? '',
          entries: new Map(directory?.entries),
        };
        directories.set(path, directory);
        copied.add(path);
      }
      touched.add(path);
      return directory;
    };

    for (let [path, entry] of changes) {
      if (entry === null && files.has(path)) {
        files.delete(path);
        markers.delete(path);
        let { directory, name } = splitPath(path);
        writable(directory).entries.delete(name);
      }
    }
    for (let [path, entry] of changes) {
      if (entry === null) {
        continue;
      }
      if (directories.has(path)) {
        if (!isEmptyDirectory(directories, path)) {
          throw new Error(
            `${JSON.stringify(path)} is a directory, so it can't be a file`,
          );
        }
        removeDirectory(directories, path);
        let { directory, name } = splitPath(path);
        writable(directory).entries.delete(name);
      }
      let segments = path.split('/');
      for (let depth = 1; depth < segments.length; depth++) {
        let ancestor = segments.slice(0, depth).join('/');
        if (files.has(ancestor)) {
          throw new Error(
            `${JSON.stringify(path)} lies under the file ${JSON.stringify(ancestor)}`,
          );
        }
        if (!directories.has(ancestor)) {
          writable(ancestor);
          let { directory, name } = splitPath(ancestor);
          writable(directory).entries.set(name, {
            mode: TREE_MODE,
            name,
            id: '',
          });
        }
      }
      files.set(path, entry);
      markers.delete(path);
      let { directory, name } = splitPath(path);
      writable(directory).entries.set(name, {
        mode: entry.mode,
        name,
        id: entry.id,
      });
    }

    // Each changed directory and its ancestors, deepest first, so a
    // directory is written after every subdirectory it holds.
    let pending = new Set<string>();
    for (let path of touched) {
      for (let ancestor of selfAndAncestors(path)) {
        pending.add(ancestor);
      }
    }
    let order = [...pending].sort((a, b) => depthOf(b) - depthOf(a));
    for (let path of order) {
      if (!directories.has(path)) {
        // Removed above, to make room for a file of the same name.
        continue;
      }
      let directory = writable(path);
      if (path !== '' && directory.entries.size === 0) {
        directories.delete(path);
        let { directory: parent, name } = splitPath(path);
        writable(parent).entries.delete(name);
        continue;
      }
      let { id } = await store.writeTree([...directory.entries.values()]);
      directory.id = id;
      if (path !== '') {
        let { directory: parent, name } = splitPath(path);
        writable(parent).entries.set(name, { mode: TREE_MODE, name, id });
      }
    }
    return new HeadTree(files, directories, markers);
  }
}

function splitPath(path: string): { directory: string; name: string } {
  let slash = path.lastIndexOf('/');
  return slash === -1
    ? { directory: '', name: path }
    : { directory: path.slice(0, slash), name: path.slice(slash + 1) };
}

function directoryOf(
  directories: Map<string, Directory>,
  path: string,
): Directory {
  let directory = directories.get(path);
  if (!directory) {
    // `ls-tree -t` lists a tree before its entries, so this is only reached
    // for a listing that isn't git's.
    throw new Error(`ls-tree listed an entry of ${path} before its tree`);
  }
  return directory;
}

// A size-only entry's tree holds exactly one entry, its marker blob. No
// realm file takes the marker's name, so a tree like that is never a
// directory the realm has.
function sizeOnlyMarkerOf(directory: Directory): string | undefined {
  if (directory.entries.size !== 1) {
    return undefined;
  }
  let marker = directory.entries.get(SIZE_ONLY_MARKER_NAME);
  return marker?.mode === BLOB_MODE ? marker.id : undefined;
}

function isEmptyDirectory(
  directories: Map<string, Directory>,
  path: string,
): boolean {
  let directory = directories.get(path)!;
  for (let [name, entry] of directory.entries) {
    let child = path === '' ? name : `${path}/${name}`;
    if (entry.mode !== TREE_MODE || !directories.has(child)) {
      return false;
    }
    if (!isEmptyDirectory(directories, child)) {
      return false;
    }
  }
  return true;
}

function removeDirectory(
  directories: Map<string, Directory>,
  path: string,
): void {
  for (let key of [...directories.keys()]) {
    if (key === path || key.startsWith(`${path}/`)) {
      directories.delete(key);
    }
  }
}

function selfAndAncestors(path: string): string[] {
  let paths = [path];
  while (path !== '') {
    path = splitPath(path).directory;
    paths.push(path);
  }
  return paths;
}

function depthOf(path: string): number {
  return path === '' ? 0 : path.split('/').length;
}
