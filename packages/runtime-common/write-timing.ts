import { logger } from './log.ts';

// The write-path counterpart of `realm:search-timing`: one line per card+json
// POST / PATCH attributing the request's server-side wall-clock across the
// stages a write runs through.
//
// A read has had a stage breakdown for a while; a write has had none, so a
// slow write could only ever be compared against the duration of the indexing
// job it waited on. When those two disagree — a PATCH far slower than its own
// incremental-index job — nothing said where the remainder went, because the
// candidates (waiting for the realm write lock, draining in-flight indexing,
// reading the card back out of the index) were not separately observable.
// These stages exist to tell those apart.
//
// Unlike search timing, this is not gated on the caller sending a correlation
// id. Writes are a small fraction of a realm's requests — on the order of
// hundreds an hour against tens of thousands of reads — so emitting for every
// write costs little, and the slow writes worth explaining are exactly the
// ones nobody thought to instrument beforehand. A correlation id, when the
// caller does send one, is stamped on the line so it joins to that request's
// `realm:requests` entry.
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
