import { logger } from './log.ts';

// The write-path counterpart of `realm:search-timing`: one line per card+json
// POST / PATCH, attributing the request's server-side wall-clock across the
// stages a write runs through.
//
// Each stage can be the whole of a slow write, and they are not
// distinguishable from outside:
//
//   lock        waiting for the write lock over the files this write touches,
//               i.e. queueing behind another writer of those files
//   drain       waiting for indexing already in flight, at either of the two
//               gates that wait for it
//   stage       reading the pre-state and running the entries' executors
//   persist     making the write durable — the bytes, the removals, and the
//               rows describing them
//   enqueue     queueing this write's own index job
//   awaitIndex  waiting for a worker to run that job. Absent when the caller
//               opted out of waiting — which is what that opt-out buys — and
//               absent on a write whose index pass threw, where the wait it
//               did spend is in `commit` instead. `status` tells those apart
//   invalidate  dropping the caches the index pass invalidated, and
//               announcing it to readers and subscribers
//   commit      assembling the file list the commit writes, and reporting
//               what landed. Reached on both sides of the realm's own stages,
//               so it appears ahead of them on the line and accumulates the
//               work after them
//   readback    reading the written card back out of the index
//   stringify   serializing the response document
//
// A write whose duration exceeds its own indexing job's is explained by
// which of these it spent the difference in; without them the remainder is
// unattributable.
//
// Every line also carries `status` — the code the write answered with, or
// `failed` where it threw instead of answering.
//
// No stage contains another: each records a window no other stage records, so
// they sum to the handler rather than over it, and a stage's share is readable
// straight off the line. The sum falls short of `handler` by the work outside
// the stages at either end — reading the request and deciding what it asks
// for, and releasing the write lock before the answer is built.
//
// A write that did not finish is short by more than that, and deliberately so.
// The stage it was in never closed, so its elapsed time lands in `commit`
// rather than being reported as a stage that ran to completion: a `persist`
// that threw partway is not a persist, and a number that could mean either
// would be worse than a residual. `status` is what says to read it that way.
//
// A stage reached more than once accumulates. A commit that indexes twice —
// a batch writing a module and an instance together, where the module has to
// be indexed before the instance can be serialized against it — reports each
// pass's files under `persist` and each pass's queue insert and wait under
// `enqueue` and `awaitIndex`. Stage names appear in the order the write first
// reached them, which for such a batch is not the order above.
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
