import { logger } from './log.ts';

// One `realm:write-timing` line per instrumented card write (POST create /
// PATCH update), the write-path twin of `realm:search-timing`. A card write
// holds the realm-wide write lock and reads the card back out of the index,
// but until now had no stage breakdown at all — so a slow write could not be
// attributed to the lock wait, the file write, the index wait, or the
// readback. Each handler stamps its sequential stages on a `RequestTimings`
// and emits one line here, keyed by the request's `x-boxel-logging-correlation-id`
// so it joins to the same client-side timing (and the `realm:requests` line)
// the search timing already keys on.
//
// Emitted only when the write carries a correlation id, exactly like
// `emitSearchTiming` — an uninstrumented write logs nothing.

// Indirection so a test can deterministically capture the emitted line, for
// the same reason `emitSearchTiming` has one: loglevel rebinds a logger's
// methods on every `setLevel`, so a test that monkeypatches a direct logger
// handle would race the next `logger('realm:write-timing')` call. A settable
// sink sidesteps that. Defaults to the `realm:write-timing` logger.
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
