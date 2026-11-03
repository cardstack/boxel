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
// A listing does not always re-read the directory. For a few seconds after
// this instance itself wrote into a directory, a listing of it comes back
// with the cached contents: it neither shows a file a peer created there in
// the meantime nor drops the stale "not here" for it, and the entry then
// lasts until the directory's attribute cache expires, up to a minute. So
// when the refreshed path has not appeared after its listings, the refresh
// lists its directories again after each of the recheck delays, stopping once
// it appears. A listing made a few seconds after the instance's own write
// re-reads the directory. A path has appeared when its directory's listing
// shows its name and a lookup of it finds it.
//
// Notifications arrive one per written path, so a batch write into one
// directory would list that directory once per file. Listings are coalesced
// per directory: while one is running, later requests wait for one pending
// follow-up listing instead of starting their own (a request that arrives
// after a listing started cannot know whether that listing already saw its
// write, so it needs one that starts later). When the pending listing starts
// it becomes the running one, so a request arriving during it can queue a
// fresh follow-up in turn.
//
// Budget: a single-path notification costs one listing per ancestor (realm
// root included) on every instance with the realm mounted — the emitting
// instance receives its own NOTIFY too. That is deliberate: realm trees are
// shallow, bursts coalesce per directory, and the simpler shape is easier to
// reason about than walking up only when the written name is missing from its
// parent's entries. A path that still reads as missing afterwards (a peer's
// write this instance cannot see yet, or a removal) costs one more listing per
// ancestor at each recheck delay; rechecks of paths in one directory coalesce
// like any other listings, and a path already being rechecked is not
// rechecked twice. Whether a path has appeared is read from those shared
// listings first, so a removed path, which its listing never shows, costs no
// lookup of its own; only a path the listing shows is looked up, to confirm
// this instance no longer answers it as missing.
//
// Containment: one ancestor failing does not stop the rest of the chain —
// the immediate parent is the listing that matters, and the realm root (first
// in the chain, always present) is the one least worth dying for. A listing
// that never settles is timed out so it stops occupying the per-directory
// slot; the kernel's own cache TTL remains the backstop either way.
// The names a listing found in its directory.
type DirectoryEntries = ReadonlySet<string>;

interface DirectoryListing {
  running: Promise<DirectoryEntries>;
  // Requested but not yet started; becomes `running` when it starts.
  pending?: Promise<DirectoryEntries>;
}

// How long after a refresh that left its path missing the refresh lists the
// path's directories again. A listing made within about three seconds of the
// instance's own write into the directory can still return its cached
// contents; the later rechecks cover a longer run of writes into it.
export const DIRECTORY_RECHECK_DELAYS_MS: readonly number[] = [
  3_000, 10_000, 30_000,
];

export class DirectoryViewRefresher {
  #listings = new Map<LocalPath, DirectoryListing>();
  #rechecking = new Set<LocalPath>();

  #listDirectory: (directory: LocalPath) => Promise<Iterable<string>>;
  #timeoutMs: number;
  #exists: ((path: LocalPath) => Promise<boolean>) | undefined;
  #recheckDelaysMs: readonly number[];

  constructor(
    // Lists a directory and resolves with the names of its entries.
    listDirectory: (directory: LocalPath) => Promise<Iterable<string>>,
    opts?: {
      timeoutMs?: number;
      // Whether a lookup of a path finds it right now. Without it a refresh
      // never rechecks.
      exists?: (path: LocalPath) => Promise<boolean>;
      recheckDelaysMs?: readonly number[];
    },
  ) {
    this.#listDirectory = listDirectory;
    this.#timeoutMs = opts?.timeoutMs ?? 15_000;
    this.#exists = opts?.exists;
    this.#recheckDelaysMs =
      opts?.recheckDelaysMs ?? DIRECTORY_RECHECK_DELAYS_MS;
  }

  // Resolves once the path's directories have been listed. Rechecks, when the
  // path has not appeared, run on their own afterwards.
  async refresh(path: LocalPath): Promise<void> {
    let { parentEntries, error } = await this.#listAncestors(path);
    void this.#recheckUntilAppeared(path, parentEntries);
    if (error) {
      throw error;
    }
  }

  async #recheckUntilAppeared(
    path: LocalPath,
    parentEntries: DirectoryEntries | undefined,
  ): Promise<void> {
    if (!this.#exists || this.#rechecking.has(path)) {
      return;
    }
    this.#rechecking.add(path);
    try {
      if (await this.#appeared(path, parentEntries)) {
        return;
      }
      for (let delayMs of this.#recheckDelaysMs) {
        await sleepUnref(delayMs);
        // A failed listing reads as the path not having appeared, which
        // leaves the next recheck, and the kernel's own cache expiry, to
        // catch up.
        let recheck = await this.#listAncestors(path);
        if (await this.#appeared(path, recheck.parentEntries)) {
          return;
        }
      }
    } finally {
      this.#rechecking.delete(path);
    }
  }

  // Whether the path's directory listing shows its name and a lookup of it
  // finds it. A lookup that fails stops the rechecks rather than repeating
  // them against an adapter that cannot answer.
  async #appeared(
    path: LocalPath,
    parentEntries: DirectoryEntries | undefined,
  ): Promise<boolean> {
    if (!parentEntries?.has(path.slice(path.lastIndexOf('/') + 1))) {
      return false;
    }
    try {
      return await this.#exists!(path);
    } catch {
      return true;
    }
  }

  // Lists every directory that leads to `path`, root first. Resolves with the
  // entries of its immediate parent (undefined when that listing failed) and
  // the failure of any listing in the chain.
  async #listAncestors(path: LocalPath): Promise<{
    parentEntries: DirectoryEntries | undefined;
    error: unknown;
  }> {
    let errors: unknown[] = [];
    let parentEntries: DirectoryEntries | undefined;
    let directories = ancestorDirectories(path);
    for (let [index, directory] of directories.entries()) {
      try {
        let entries = await this.#list(directory);
        if (index === directories.length - 1) {
          parentEntries = entries;
        }
      } catch (err) {
        errors.push(err);
      }
    }
    let error: unknown;
    if (errors.length === 1) {
      error = errors[0];
    } else if (errors.length > 1) {
      let messages = errors
        .map((err) => (err instanceof Error ? err.message : String(err)))
        .join('; ');
      error = new Error(`directory refresh partially failed: ${messages}`);
    }
    return { parentEntries, error };
  }

  #list(directory: LocalPath): Promise<DirectoryEntries> {
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

  #startListing(directory: LocalPath): Promise<DirectoryEntries> {
    // The timeout does not cancel the underlying listing — it releases the
    // per-directory slot, so a hung filesystem call stops blocking every
    // later refresh of this directory for the life of the process. A fresh
    // listing may then overlap the hung one; overlapping reads are safe.
    let running = this.#withTimeout(
      this.#listDirectory(directory).then((names) => new Set(names)),
      directory,
    );
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

  #withTimeout<T>(listing: Promise<T>, directory: LocalPath): Promise<T> {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        reject(
          new Error(
            `timed out listing "${directory}" after ${this.#timeoutMs}ms`,
          ),
        );
      }, this.#timeoutMs);
      // In Node, don't let a pending timer hold the process open.
      (timer as { unref?: () => void }).unref?.();
      listing.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}

function sleepUnref(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(resolve, ms);
    // In Node, don't let a pending recheck hold the process open.
    (timer as { unref?: () => void }).unref?.();
  });
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
