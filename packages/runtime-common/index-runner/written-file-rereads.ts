// Re-reads a file that reads as missing although the realm records it: the
// realm just wrote it, or the committed index holds it.
//
// Several realm-server instances serve one realm from a shared network
// filesystem, and the instance that answers a read can still hold a cached
// "this name is not here" from a lookup it made just before another instance
// wrote the file. The cross-instance directory refresh (see
// DirectoryViewRefresher) clears that entry in most cases. It does not when
// the answering instance had itself written into the same directory moments
// earlier: the entry then lasts until the kernel's attribute cache for the
// directory expires, which takes anywhere from under a second to a minute.
// Taking the first miss as a removal drops a file the realm just wrote from
// the index, and nothing indexes it again until the file changes. Re-reading
// through that window is what keeps the file.
//
// The delays sum to just over a minute: the NFS client's default ceiling for
// caching a directory's attributes is 60 seconds.
export const WRITTEN_FILE_REREAD_DELAYS_MS: readonly number[] = [
  500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000,
];

export interface WrittenFileRereadResult<T> {
  value: T | undefined;
  // Reads made here, beyond the caller's own first read.
  rereads: number;
  waitedMs: number;
  // True when the re-reads stopped because the realm stopped recording the
  // file, which is a removal rather than a stale view.
  removed: boolean;
}

// One per pass. The window opens at the pass's first re-read and spans the sum
// of the delays, and every later re-read in the pass shares what is left of
// it. A bulk write whose files all read as missing (a new directory the
// answering instance cannot see yet) therefore costs the pass one window, not
// one per file. Once the window has closed, a missing file is taken as gone on
// the caller's first read.
export class WrittenFileRereads {
  #delaysMs: readonly number[];
  #sleep: (ms: number) => Promise<void>;
  #now: () => number;
  #closesAt: number | undefined;

  constructor(
    opts: {
      delaysMs?: readonly number[];
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    } = {},
  ) {
    this.#delaysMs = opts.delaysMs ?? WRITTEN_FILE_REREAD_DELAYS_MS;
    this.#sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = opts.now ?? Date.now;
  }

  // Calls `read` after each delay until it returns a file or the pass's window
  // closes. `realmRecordsFile` is asked before each wait, so a file the realm
  // removed meanwhile stops the re-reads at once instead of holding the pass
  // for the rest of the window.
  async reread<T>(
    read: () => Promise<T | undefined>,
    realmRecordsFile: () => Promise<boolean>,
  ): Promise<WrittenFileRereadResult<T>> {
    let start = this.#now();
    this.#closesAt ??=
      start + this.#delaysMs.reduce((sum, delayMs) => sum + delayMs, 0);
    let rereads = 0;
    let result = (value: T | undefined, removed = false) => ({
      value,
      rereads,
      waitedMs: this.#now() - start,
      removed,
    });
    for (let delayMs of this.#delaysMs) {
      let remainingMs = this.#closesAt - this.#now();
      if (remainingMs <= 0) {
        break;
      }
      if (!(await realmRecordsFile())) {
        return result(undefined, true);
      }
      await this.#sleep(Math.min(delayMs, remainingMs));
      rereads++;
      let value = await read();
      if (value !== undefined) {
        return result(value);
      }
    }
    // Asked again once the window is spent, so a file the realm removed reads
    // as a removal even when the window had already closed before this file.
    return result(undefined, !(await realmRecordsFile()));
  }
}
