import type { LocalPath } from './paths.ts';

// Refreshes a realm-server instance's view of the directories that hold a
// path another instance just wrote or deleted.
//
// The realm directory is a shared network filesystem (EFS/NFS) when several
// realm-server instances run at once, and each instance's kernel caches its
// own view of every directory — including "this name is not here" answers
// from earlier lookups. A file a peer just wrote therefore keeps reading as
// missing on this instance until the directory's attribute cache expires,
// tens of seconds later. Listing a directory makes the kernel re-read it from
// the server, which discards the stale negative entries, so the next lookup of
// the path sees the file. The listing is done for every ancestor, root first,
// because the peer's write may have created the parent directories too and a
// stale "not here" for `new-dir` would otherwise hide `new-dir/file` even
// after `new-dir` itself is listed.
//
// Notifications arrive one per written path, so a batch write into one
// directory would list that directory once per file. Listings are coalesced
// per directory: while one is in flight, later requests share it, and at most
// one follow-up listing is queued behind it (a request that arrives after a
// listing started cannot know whether that listing already saw its write).
interface InFlightListing {
  current: Promise<void>;
  queued?: Promise<void>;
}

export class DirectoryViewRefresher {
  #listings = new Map<LocalPath, InFlightListing>();

  #listDirectory: (directory: LocalPath) => Promise<void>;

  constructor(listDirectory: (directory: LocalPath) => Promise<void>) {
    this.#listDirectory = listDirectory;
  }

  async refresh(path: LocalPath): Promise<void> {
    for (let directory of ancestorDirectories(path)) {
      await this.#list(directory);
    }
  }

  #list(directory: LocalPath): Promise<void> {
    let entry = this.#listings.get(directory);
    if (!entry) {
      let current = this.#listDirectory(directory);
      let created: InFlightListing = { current };
      this.#listings.set(directory, created);
      let cleanup = () => {
        if (this.#listings.get(directory) === created && !created.queued) {
          this.#listings.delete(directory);
        }
      };
      current.then(cleanup, cleanup);
      return current;
    }
    if (entry.queued) {
      return entry.queued;
    }
    let settled = entry;
    let queued = entry.current
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => this.#listDirectory(directory));
    settled.queued = queued;
    let cleanup = () => {
      if (this.#listings.get(directory) === settled) {
        this.#listings.delete(directory);
      }
    };
    queued.then(cleanup, cleanup);
    return queued;
  }
}

// The directories that lead to `path`, realm root first: for `a/b/c.json`
// this is `''`, `a`, `a/b`.
export function ancestorDirectories(path: LocalPath): LocalPath[] {
  let directories: LocalPath[] = [''];
  let segments = path.split('/');
  for (let i = 1; i < segments.length; i++) {
    directories.push(segments.slice(0, i).join('/'));
  }
  return directories;
}
