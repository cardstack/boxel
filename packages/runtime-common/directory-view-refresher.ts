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
// per directory: while one is running, later requests wait for one pending
// follow-up listing instead of starting their own (a request that arrives
// after a listing started cannot know whether that listing already saw its
// write, so it needs one that starts later). When the pending listing starts
// it becomes the running one, so a request arriving during it can queue a
// fresh follow-up in turn.
interface DirectoryListing {
  running: Promise<void>;
  // Requested but not yet started; becomes `running` when it starts.
  pending?: Promise<void>;
}

export class DirectoryViewRefresher {
  #listings = new Map<LocalPath, DirectoryListing>();

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
    let listing = this.#listings.get(directory);
    if (!listing) {
      return this.#startListing(directory);
    }
    if (!listing.pending) {
      listing.pending = listing.running
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => this.#startListing(directory));
    }
    // The pending listing has not started yet, so it is guaranteed to observe
    // the write behind this request.
    return listing.pending;
  }

  #startListing(directory: LocalPath): Promise<void> {
    let running = this.#listDirectory(directory);
    let listing: DirectoryListing = { running };
    // Replaces any predecessor (whose `pending` was this very listing), so a
    // request arriving from here on queues behind this listing instead of
    // sharing it.
    this.#listings.set(directory, listing);
    let cleanup = () => {
      if (this.#listings.get(directory) === listing && !listing.pending) {
        this.#listings.delete(directory);
      }
    };
    running.then(cleanup, cleanup);
    return running;
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
