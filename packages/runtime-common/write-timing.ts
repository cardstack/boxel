import { logger } from './log.ts';

// The write-path counterpart of `realm:search-timing`: one line per card+json
// POST / PATCH, attributing the request's server-side wall-clock across the
// stages a write runs through.
//
// Each stage can be the whole of a slow write, and they are not
// distinguishable from outside:
//
//   lock      waiting for the realm's write lock, i.e. queueing behind the
//             realm's other writers
//   drain     waiting for indexing already in flight
//   stage     reading the pre-state and running the entries' executors
//   write     committing the bytes, plus this write's own indexing unless
//             the caller opted out
//   readback  reading the written card back out of the index
//   stringify serializing the response document
//
// A write whose duration exceeds its own indexing job's is explained by
// which of these it spent the difference in; without them the remainder is
// unattributable.
//
// Unlike search timing this is not gated on the caller sending a correlation
// id. Writes are a small fraction of a realm's requests — hundreds an hour
// against tens of thousands of reads — so emitting for every write costs
// little, and a slow write is rarely one that was instrumented in advance. A
// correlation id, when the caller sends one, is stamped on the line so it
// joins that request's `realm:requests` entry.
//
// Indirection so a test can deterministically capture the emitted line:
// loglevel rebinds a logger's methods on every `setLevel`, so a test that
// monkeypatched a direct logger handle would race the next
// `logger('realm:write-timing')` call. A settable sink sidesteps that, the
// same way `emitSearchTiming` does.
let writeTimingSink: ((line: string) => void) | undefined;
let writeTimingLog: ReturnType<typeof logger> | undefined;

export function setWriteTimingSinkForTests(
  sink: ((line: string) => void) | undefined,
): void {
  writeTimingSink = sink;
}

export function emitWriteTiming(line: string): void {
  if (writeTimingSink) {
    writeTimingSink(line);
    return;
  }
  // Lazy: a module-load `logger()` call races the circular import that
  // installs the logger factory. First emission happens well after boot.
  (writeTimingLog ??= logger('realm:write-timing')).info(line);
}
