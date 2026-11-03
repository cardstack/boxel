// Re-reads a file that reads as missing although the realm records it: the
// realm just wrote it, or the committed index holds it.
//
// Several realm-server instances serve one realm from a shared network
// filesystem, and the instance that answers a read can still hold a cached
// "this name is not here" from a lookup it made just before another instance
// wrote the file. The cross-instance directory refresh (see
// DirectoryViewRefresher) usually clears that entry, but not always, and an
// entry it leaves behind lasts until the kernel's attribute cache for the
// directory expires: anywhere from under a second to a minute.
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

export interface WrittenFileRereadLog {
  info(message: string): void;
  warn(message: string): void;
}

// One per pass. The pass's re-reads share one budget of waiting, the sum of
// the delays: each re-read spends what it sleeps, and one that finds its file
// stops spending. A bulk write whose files all read as missing (a new
// directory the answering instance cannot see yet) therefore costs the pass
// one window of waiting, not one per file, while a miss that recovers early
// leaves the rest of the budget to any later miss, however long the pass runs
// in between. Once the budget is spent, a missing file is taken as gone on the
// caller's first read.
export class WrittenFileRereads {
  #delaysMs: readonly number[];
  #sleep: (ms: number) => Promise<void>;
  #remainingMs: number;

  constructor(
    opts: {
      delaysMs?: readonly number[];
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.#delaysMs = opts.delaysMs ?? WRITTEN_FILE_REREAD_DELAYS_MS;
    this.#sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#remainingMs = this.#delaysMs.reduce(
      (sum, delayMs) => sum + delayMs,
      0,
    );
  }

  // Reads a file the pass visits. When `read` finds nothing, re-reads it
  // through the pass's budget while `realmRecordsFile` holds, and logs what the
  // re-reads came to. `label` leads each log line and names the file;
  // `ifMissing` says what the pass does with a file that stays missing.
  async readVisitedFile<T>(
    read: () => Promise<T | undefined>,
    {
      realmRecordsFile,
      label,
      ifMissing,
      log,
    }: {
      realmRecordsFile: () => Promise<boolean>;
      label: string;
      ifMissing: string;
      log: WrittenFileRereadLog;
    },
  ): Promise<T | undefined> {
    let first = await read();
    if (first !== undefined) {
      return first;
    }
    let { value, rereads, waitedMs, removed } = await this.reread(
      read,
      realmRecordsFile,
    );
    if (value !== undefined) {
      log.info(
        `${label} read on re-read ${rereads} after ${waitedMs}ms; the realm first answered it as missing`,
      );
    } else if (!removed) {
      log.warn(
        `${label} is recorded by the realm but still reads as missing after ${rereads} re-reads over ${waitedMs}ms; ${ifMissing}`,
      );
    } else if (rereads > 0) {
      log.info(
        `${label} was removed after ${rereads} re-reads over ${waitedMs}ms; ${ifMissing}`,
      );
    }
    return value;
  }

  // Calls `read` after each delay until it returns a file or the pass's
  // budget is spent. `realmRecordsFile` is asked before each wait, so a file
  // the realm removed meanwhile stops the re-reads at once instead of holding
  // the pass for the rest of the budget.
  async reread<T>(
    read: () => Promise<T | undefined>,
    realmRecordsFile: () => Promise<boolean>,
  ): Promise<WrittenFileRereadResult<T>> {
    let rereads = 0;
    let waitedMs = 0;
    let result = (value: T | undefined, removed = false) => ({
      value,
      rereads,
      waitedMs,
      removed,
    });
    for (let delayMs of this.#delaysMs) {
      if (this.#remainingMs <= 0) {
        break;
      }
      if (!(await realmRecordsFile())) {
        return result(undefined, true);
      }
      let sleepMs = Math.min(delayMs, this.#remainingMs);
      // Spent before the wait, so re-reads that overlap cannot together wait
      // longer than the budget.
      this.#remainingMs -= sleepMs;
      await this.#sleep(sleepMs);
      waitedMs += sleepMs;
      rereads++;
      let value = await read();
      if (value !== undefined) {
        return result(value);
      }
    }
    // Asked again once the budget is spent, so a file the realm removed reads
    // as a removal even when the budget ran out before this file.
    return result(undefined, !(await realmRecordsFile()));
  }
}
