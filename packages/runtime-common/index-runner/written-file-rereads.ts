import { now as clockNow } from '../clock.ts';
import type { TextFileRef } from '../stream.ts';
import type { Reader } from '../worker.ts';

// Re-reads a file that reads as missing although the realm created it moments
// ago.
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

// How long after the realm creates a file a read of it can still miss only
// because the answering instance's view predates the file. A stale "not here"
// is left from a lookup made before the file existed, and lasts until that
// instance's attribute cache for the directory expires, about a minute; this
// leaves a wide margin past that. A file the realm created longer ago that
// reads as missing is gone, whatever the realm's record of it says. A record
// can outlive its file: a removal the realm learns of from its file watcher
// leaves the record, and so does a delete interrupted between removing the
// file and removing its record.
export const STALE_MISS_HORIZON_MS = 5 * 60_000;

// One read of a file a pass visits: the file, or the status of the realm's
// answer without it. Only a 404, the realm finding no file there, can come
// from a stale view. Any other answer that serves no file, such as an archived
// realm's 403 or a route that answers the path, is the realm's answer about
// the file itself, and it gives the same one however often it is asked.
export type VisitedFileRead<T> =
  | { file: T; missingStatus?: undefined }
  | { file?: undefined; missingStatus: number };

// Reads the file at the first of `urls` that serves one. A miss carries the
// first status other than 404 that any of them answered, and 404 otherwise,
// including when the reader reports no status.
export function readServedFile(
  reader: Reader,
  urls: URL[],
): () => Promise<VisitedFileRead<TextFileRef>> {
  return async () => {
    let missingStatus: number | undefined;
    let onNoFile = (status: number) => {
      if (status !== 404) {
        missingStatus ??= status;
      }
    };
    for (let url of urls) {
      let file = await reader.readFile(url, { onNoFile });
      if (file) {
        return { file };
      }
    }
    return { missingStatus: missingStatus ?? 404 };
  };
}

export interface WrittenFileRereadResult<T> {
  value: T | undefined;
  // Reads made here, beyond the caller's own first read.
  rereads: number;
  waitedMs: number;
  // True when the re-reads stopped because the miss is a removal rather than
  // a stale view: the realm records no file there, or created the one it
  // records longer ago than STALE_MISS_HORIZON_MS.
  removed: boolean;
  // The status of a re-read the realm answered with something other than a
  // 404, which stopped the re-reads.
  refusedStatus?: number;
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
  #now: () => number;

  constructor(
    opts: {
      delaysMs?: readonly number[];
      sleep?: (ms: number) => Promise<void>;
      // The clock a record's age is measured on: the one the realm stamps
      // records from.
      now?: () => number;
    } = {},
  ) {
    this.#delaysMs = opts.delaysMs ?? WRITTEN_FILE_REREAD_DELAYS_MS;
    this.#sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#remainingMs = this.#delaysMs.reduce(
      (sum, delayMs) => sum + delayMs,
      0,
    );
    this.#now = opts.now ?? clockNow;
  }

  // Reads a file the pass visits. When the realm finds no file there (a 404),
  // re-reads it through the pass's budget while the realm's record says it
  // created the file recently, and logs what the re-reads came to. Any other
  // answer without the file is taken as it is, with no re-read. `label` leads
  // each log line and names the file; `ifMissing` says what the pass does with
  // a file that stays missing.
  async readVisitedFile<T>(
    read: () => Promise<VisitedFileRead<T>>,
    {
      recordedCreatedAt,
      label,
      ifMissing,
      log,
    }: {
      recordedCreatedAt: () => Promise<number | undefined>;
      label: string;
      ifMissing: string;
      log: WrittenFileRereadLog;
    },
  ): Promise<T | undefined> {
    let first = await read();
    if (first.file !== undefined || first.missingStatus !== 404) {
      return first.file;
    }
    let { value, rereads, waitedMs, removed, refusedStatus } =
      await this.reread(read, recordedCreatedAt);
    if (value !== undefined) {
      log.info(
        `${label} read on re-read ${rereads} after ${waitedMs}ms; the realm first answered it as missing`,
      );
    } else if (refusedStatus !== undefined) {
      log.info(
        `${label} was answered with status ${refusedStatus} on re-read ${rereads} after ${waitedMs}ms; ${ifMissing}`,
      );
    } else if (!removed) {
      log.warn(
        `${label} was just created by the realm but still reads as missing after ${rereads} re-reads over ${waitedMs}ms; ${ifMissing}`,
      );
    } else if (rereads > 0) {
      log.info(
        `${label} was removed after ${rereads} re-reads over ${waitedMs}ms; ${ifMissing}`,
      );
    }
    return value;
  }

  // Calls `read` after each delay until it returns a file, the realm answers
  // it with a status other than 404, or the pass's budget is spent.
  // `recordedCreatedAt` gives when the realm's record says it created the
  // file, in epoch seconds, read fresh; undefined when the realm records no
  // file there. It is asked before each wait, so a file the realm removed
  // meanwhile stops the re-reads at once instead of holding the pass for the
  // rest of the budget.
  async reread<T>(
    read: () => Promise<VisitedFileRead<T>>,
    recordedCreatedAt: () => Promise<number | undefined>,
  ): Promise<WrittenFileRereadResult<T>> {
    let mayStillAppear = async () => {
      let createdAt = await recordedCreatedAt();
      return (
        createdAt !== undefined &&
        this.#now() - createdAt * 1000 <= STALE_MISS_HORIZON_MS
      );
    };
    let rereads = 0;
    let waitedMs = 0;
    let result = (
      value: T | undefined,
      removed = false,
      refusedStatus?: number,
    ): WrittenFileRereadResult<T> => ({
      value,
      rereads,
      waitedMs,
      removed,
      ...(refusedStatus !== undefined ? { refusedStatus } : {}),
    });
    for (let delayMs of this.#delaysMs) {
      if (this.#remainingMs <= 0) {
        break;
      }
      if (!(await mayStillAppear())) {
        return result(undefined, true);
      }
      let sleepMs = Math.min(delayMs, this.#remainingMs);
      // Spent before the wait, so re-reads that overlap cannot together wait
      // longer than the budget.
      this.#remainingMs -= sleepMs;
      await this.#sleep(sleepMs);
      waitedMs += sleepMs;
      rereads++;
      let { file, missingStatus } = await read();
      if (file !== undefined) {
        return result(file);
      }
      if (missingStatus !== 404) {
        return result(undefined, false, missingStatus);
      }
    }
    // Asked again once the budget is spent, so a file the realm removed reads
    // as a removal even when the budget ran out before this file.
    return result(undefined, !(await mayStillAppear()));
  }
}
